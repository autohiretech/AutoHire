#!/usr/bin/env node
// Turn a catalogue-only demo host into an account someone can sign into.
//
// Migration 024 seeded hosts as `profiles` rows with text ids (`demo-host-rw-1`)
// and no `auth.users` behind them — inventory, not accounts. To sign in as one,
// it needs an auth user, and `profiles.id` has to BECOME that user's uuid,
// because Supabase mints the uuid and every policy in the app reads
// `auth.uid()`.
//
// Moving the id moves everything hanging off it: listings, bookings, payouts,
// conversations, messages, reviews, notifications, disputes, documents. That is
// only safe because migration 049 put `on update cascade` on all fifteen
// foreign keys, so Postgres carries them across in one statement. Without that
// migration this script cannot work and must not be run.
//
//   SUPABASE_URL=https://gsnoggfofbmzamxxyazc.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=… \
//   node scripts/give-demo-hosts-logins.mjs --password '<password>' --dry-run
//
// Drop --dry-run to write. Flags:
//   --hosts a,b,c    profile ids to convert (default: the Rwandan demo hosts)
//   --password <pw>  password to set (required unless --dry-run)
//
// Idempotent: a profile whose id is already a uuid is treated as done and
// skipped, so a re-run after a partial pass finishes the rest.

const DRY_RUN = process.argv.includes('--dry-run');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PASSWORD = arg('--password', '');

/** The Rwandan demo hosts — the market whose payouts actually work today. */
const DEFAULT_HOSTS = ['demo-host-rw-1', 'demo-host-rw-2', 'demo-mhost-rw', 'host-1', 'host-2', 'host-3'];
const HOSTS = arg('--hosts', '')
  ? arg('--hosts', '').split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_HOSTS;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function api(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} on ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const rest = (p, init) => api(`/rest/v1${p}`, init);
const auth = (p, init) => api(`/auth/v1${p}`, init);

/**
 * A demo host's email is a `.example` address that cannot receive mail, which is
 * the point — nothing must ever be delivered to it. It still has to be unique
 * and well-formed for auth to accept it.
 */
function loginEmail(profile) {
  return String(profile.email ?? `${profile.id}@autohire.demo`).toLowerCase();
}

async function main() {
  const missing = [
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY],
    ...(DRY_RUN ? [] : [['--password', PASSWORD]]),
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`Missing: ${missing.join(', ')}`);
    process.exit(1);
  }

  const profiles = await rest(
    `/profiles?select=id,full_name,business_name,email,role,country,payhold_seller_id` +
      `&id=in.(${HOSTS.map(encodeURIComponent).join(',')})&order=id`,
  );

  console.log(`\n${profiles.length} host${profiles.length === 1 ? '' : 's'}${DRY_RUN ? ' (dry run)' : ''}\n`);

  const results = [];
  for (const p of profiles) {
    const email = loginEmail(p);
    const counts = await rest(`/listings?select=id&host_id=eq.${encodeURIComponent(p.id)}`);
    console.log(`  ${p.id.padEnd(16)} ${String(p.country ?? '—').padEnd(3)} ${email.padEnd(34)} ${counts.length} cars`);
    results.push({ ...p, email, cars: counts.length });
  }
  console.log();

  if (DRY_RUN) {
    console.log('Dry run — no users created and no ids changed.');
    return;
  }

  let done = 0;
  let skipped = 0;

  for (const p of results) {
    if (UUID_RE.test(p.id)) {
      console.log(`· ${p.id}: already an account — skipped`);
      skipped++;
      continue;
    }

    try {
      // 1. Mint the auth user. Confirmed on creation: nothing can be delivered
      //    to a .example address, so an unconfirmed account would be unusable.
      const user = await auth('/admin/users', {
        method: 'POST',
        body: { email: p.email, password: PASSWORD, email_confirm: true },
      });
      if (!user?.id) throw new Error(`auth returned no id: ${JSON.stringify(user).slice(0, 200)}`);

      // 2. Move the profile onto it. Migration 049's `on update cascade` drags
      //    every listing, booking, payout, message and dispute across with it,
      //    atomically — this single statement is the whole migration of the
      //    host's data.
      await rest(`/profiles?id=eq.${encodeURIComponent(p.id)}`, {
        method: 'PATCH',
        body: { id: user.id },
      });

      const after = await rest(`/listings?select=id&host_id=eq.${encodeURIComponent(user.id)}`);
      const ok = after.length === p.cars;
      console.log(
        `${ok ? '✓' : '!'} ${p.full_name} → ${p.email}  (${after.length}/${p.cars} cars carried over)`,
      );
      if (!ok) console.error(`  WARNING: car count changed for ${p.id}`);
      done++;
    } catch (e) {
      console.error(`✗ ${p.id}: ${e.message}`);
    }
  }

  console.log(`\n${done} converted, ${skipped} already accounts.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
