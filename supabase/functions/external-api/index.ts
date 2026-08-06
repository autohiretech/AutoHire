// AutoHire — external-api Edge Function.
//
// The read API the external system calls to see AutoHire's data: users, hosts,
// companies, disputes, bookings and listings. This is the INBOUND direction —
// their server calls us. (The outbound direction, us calling their payment
// system, is _shared/external-payments.ts.)
//
// Auth is an API key, not a user session: `X-API-Key: <EXTERNAL_API_KEY>`. The
// key grants access to every account's data, so it is a service credential —
// keep it server-side and rotate it like any other secret.
//
// Read-only, with one exception: a dispute's status can be PATCHed, so the
// external system can resolve a case it adjudicated. Nothing else is writable.
//
// Columns are ALLOWLISTED per resource (never `select('*')`), so a column added
// later — a token, a document, a raw destination — cannot leak into this API by
// accident. Adding a field is a deliberate edit here.
//
// Secrets:  EXTERNAL_API_KEY (required), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy external-api --no-verify-jwt
//           (no JWT: the caller is their server, not a signed-in user)
//
// Routes
//   GET   /external-api/health
//   GET   /external-api/users        ?role= &country= &verification= &q=
//   GET   /external-api/users/:id
//   GET   /external-api/hosts        ?country= &ownerType= &q=
//   GET   /external-api/hosts/:id
//   GET   /external-api/companies    ?country= &q=
//   GET   /external-api/companies/:id
//   GET   /external-api/disputes     ?status= &bookingId= &raisedBy= &against=
//   GET   /external-api/disputes/:id
//   PATCH /external-api/disputes/:id           { "status": "resolved_renter" }
//   GET   /external-api/bookings     ?state= &hostId= &renterId= &listingId=
//   GET   /external-api/bookings/:id
//   GET   /external-api/listings     ?country= &status= &hostId= &city=
//   GET   /external-api/listings/:id
//
// All list routes take ?limit= (default 50, max 200) and ?offset=, and answer
//   { "data": [...], "page": { "limit": 50, "offset": 0, "total": 123 } }
// Single routes answer { "data": { … } }. Errors answer
//   { "error": { "code": "not_found", "message": "…" } }

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
};

const API_KEY = Deno.env.get('EXTERNAL_API_KEY') ?? '';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function fail(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

/** Constant-time compare — a length-leaking early return is enough to attack. */
function secureEquals(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/** snake_case DB row -> camelCase, matching the app's data client mapper. */
function toCamelRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------
//
// Adding a resource is one entry here. `columns` is the allowlist — anything
// not named is invisible to this API.
//
// DELIBERATELY EXCLUDED, everywhere:
//   • profiles.payout_beneficiary — the provider's payout token
//   • profiles.payment_ref        — the payment provider's vault token
//   Both are credentials. The external system issued them, so it can already
//   map by profile id; re-serving them only widens what a leaked key exposes.
//   Raw destinations don't exist in the database at all — only masked ones.

const PROFILE_COLUMNS = [
  'id',
  'full_name',
  'business_name',
  'email',
  'phone',
  'role',
  'owner_type',
  'country',
  'joined_at',
  'verification',
  'rating_avg',
  'rating_count',
  'vehicle_count',
  'payout_terms',
  'insurance_type',
  // Connected-state only, never the credential itself.
  'payout_method',
  'payout_provider',
  'payout_status',
  'payout_destination',
  'payout_label',
  'payment_method',
  'payment_status',
  'payment_destination',
  'payment_label',
].join(', ');

interface Resource {
  table: string;
  columns: string;
  /** Applied to every query on this resource — how hosts differ from users. */
  scope?: (q: PostgrestQuery) => PostgrestQuery;
  /** ?param -> column, for the filters this resource accepts. */
  filters: Record<string, string>;
  /** Free-text search columns for ?q=. */
  search?: string[];
  orderBy: { column: string; ascending: boolean };
}

// The bits of the PostgREST builder this file uses. The SDK's own generics need
// generated DB types we don't have here.
interface PostgrestQuery {
  eq(column: string, value: unknown): PostgrestQuery;
  or(filter: string): PostgrestQuery;
  order(column: string, opts: { ascending: boolean }): PostgrestQuery;
  range(from: number, to: number): PostgrestQuery;
  // deno-lint-ignore no-explicit-any
  then: any;
}

const RESOURCES: Record<string, Resource> = {
  users: {
    table: 'profiles',
    columns: PROFILE_COLUMNS,
    filters: { role: 'role', country: 'country', verification: 'verification', ownerType: 'owner_type' },
    search: ['full_name', 'business_name', 'email'],
    orderBy: { column: 'joined_at', ascending: false },
  },
  hosts: {
    table: 'profiles',
    columns: PROFILE_COLUMNS,
    // A host is an account with the owner role — individual or company.
    scope: (q) => q.eq('role', 'owner'),
    filters: { country: 'country', ownerType: 'owner_type', verification: 'verification' },
    search: ['full_name', 'business_name', 'email'],
    orderBy: { column: 'joined_at', ascending: false },
  },
  companies: {
    table: 'profiles',
    columns: PROFILE_COLUMNS,
    // Companies are the business-typed hosts. They host only — they never rent.
    scope: (q) => q.eq('owner_type', 'business'),
    filters: { country: 'country', verification: 'verification' },
    search: ['business_name', 'full_name', 'email'],
    orderBy: { column: 'joined_at', ascending: false },
  },
  disputes: {
    table: 'disputes',
    columns: 'id, booking_id, raised_by, against, reason, amount_rwf, created_at, status',
    filters: { status: 'status', bookingId: 'booking_id', raisedBy: 'raised_by', against: 'against' },
    orderBy: { column: 'created_at', ascending: false },
  },
  bookings: {
    table: 'bookings',
    columns:
      'id, listing_id, renter_id, host_id, start_date, end_date, days, state, ' +
      'subtotal_rwf, service_fee_rwf, total_rwf, payment_status, provider, ' +
      'charge_currency, hold_status, payment_intent_id, created_at',
    filters: { state: 'state', hostId: 'host_id', renterId: 'renter_id', listingId: 'listing_id' },
    orderBy: { column: 'created_at', ascending: false },
  },
  listings: {
    table: 'listings',
    columns:
      'id, title, host_id, make, model, year, seats, transmission, fuel, category, ' +
      'price_per_day_rwf, price_currency, country, city, location, status, ' +
      'maintenance_until, booking_mode, rating_avg, rating_count',
    filters: { country: 'country', status: 'status', hostId: 'host_id', city: 'city' },
    search: ['title', 'make', 'model'],
    orderBy: { column: 'rating_avg', ascending: false },
  },
};

/** The only write this API allows. */
const DISPUTE_STATUSES = new Set([
  'open',
  'under_review',
  'resolved_renter',
  'resolved_host',
  'dismissed',
]);

// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (!API_KEY) {
      return fail('not_configured', 'EXTERNAL_API_KEY is not set on this deployment.', 503);
    }
    const presented = req.headers.get('x-api-key') ?? '';
    if (!presented || !secureEquals(presented, API_KEY)) {
      return fail('unauthorized', 'A valid X-API-Key header is required.', 401);
    }

    const url = new URL(req.url);
    // Path is /<function-name>/<resource>[/<id>] once Supabase has routed it.
    const parts = url.pathname.split('/').filter(Boolean);
    const fnIndex = parts.indexOf('external-api');
    const [resourceName, id] = fnIndex === -1 ? parts : parts.slice(fnIndex + 1);

    if (!resourceName || resourceName === 'health') {
      return json({ data: { status: 'ok', resources: Object.keys(RESOURCES) } }, 200);
    }

    const resource = RESOURCES[resourceName];
    if (!resource) {
      return fail('not_found', `Unknown resource '${resourceName}'.`, 404);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // --- Write: resolve a dispute ------------------------------------------
    if (req.method === 'PATCH') {
      if (resourceName !== 'disputes' || !id) {
        return fail('method_not_allowed', 'Only a dispute status may be updated.', 405);
      }
      const body = await req.json().catch(() => ({}));
      const status = String((body as { status?: string }).status ?? '');
      if (!DISPUTE_STATUSES.has(status)) {
        return fail(
          'invalid_status',
          `status must be one of: ${[...DISPUTE_STATUSES].join(', ')}.`,
          400,
        );
      }
      const { data, error } = await admin
        .from('disputes')
        .update({ status })
        .eq('id', id)
        .select(resource.columns)
        .maybeSingle();
      if (error) return fail('update_failed', error.message, 400);
      if (!data) return fail('not_found', `No dispute with id '${id}'.`, 404);
      return json({ data: toCamelRow(data as unknown as Record<string, unknown>) }, 200);
    }

    if (req.method !== 'GET') {
      return fail('method_not_allowed', `${req.method} is not supported.`, 405);
    }

    // --- Read: one -----------------------------------------------------------
    if (id) {
      let q = admin.from(resource.table).select(resource.columns).eq('id', id) as unknown as PostgrestQuery;
      if (resource.scope) q = resource.scope(q);
      const { data, error } = await (q as unknown as {
        maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
      }).maybeSingle();
      if (error) return fail('query_failed', error.message, 400);
      if (!data) return fail('not_found', `No ${resourceName} with id '${id}'.`, 404);
      return json({ data: toCamelRow(data as Record<string, unknown>) }, 200);
    }

    // --- Read: many ----------------------------------------------------------
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
    );
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);

    let q = admin
      .from(resource.table)
      .select(resource.columns, { count: 'exact' }) as unknown as PostgrestQuery;
    if (resource.scope) q = resource.scope(q);

    for (const [param, column] of Object.entries(resource.filters)) {
      const value = url.searchParams.get(param);
      if (value) q = q.eq(column, value);
    }

    const search = url.searchParams.get('q');
    if (search && resource.search?.length) {
      // PostgREST `or` takes a comma-joined filter list; commas inside the term
      // would split it, so they're stripped rather than escaped.
      const safe = search.replace(/[,()]/g, ' ').trim();
      if (safe) q = q.or(resource.search.map((c) => `${c}.ilike.%${safe}%`).join(','));
    }

    q = q.order(resource.orderBy.column, { ascending: resource.orderBy.ascending });
    q = q.range(offset, offset + limit - 1);

    const { data, error, count } = (await q) as unknown as {
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
      count: number | null;
    };
    if (error) return fail('query_failed', error.message, 400);

    return json(
      {
        data: (data ?? []).map(toCamelRow),
        page: { limit, offset, total: count ?? 0 },
      },
      200,
    );
  } catch (e) {
    return fail('server_error', e instanceof Error ? e.message : String(e), 500);
  }
});
