#!/usr/bin/env node
// Give every demo host a payout method — and a real PayHold seller behind it.
//
// PayHold will not open a deal for a host it has no seller for, so a demo host
// with no payout method has unbookable cars (docs/payhold.md §9). Real hosts fix
// that themselves at /payouts/setup, where they type a raw destination that goes
// straight to PayHold to be tokenized. The demo hosts seeded by migrations
// 024/026/027 have no login, so nobody can ever type one for them — this script
// is their stand-in, and the only reason it can exist is that their destinations
// are made up.
//
// It is deliberately NOT a migration. `POST /v1/sellers` is a network call to
// another system that mints permanent records; SQL cannot make it, and a
// migration that pretended to would leave `payhold_seller_id` null and the cars
// still unbookable.
//
//   SUPABASE_URL=https://gsnoggfofbmzamxxyazc.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=… \
//   PAYHOLD_BASE_URL=https://mwnbjjlilqrwdmwutbxr.supabase.co/functions/v1 \
//   PAYHOLD_API_KEY=… \
//   node scripts/seed-host-payout-methods.mjs --dry-run
//
// Drop --dry-run to write. Flags:
//   --dry-run          print the plan, call nothing, write nothing
//   --prefix <str>     which profiles to seed (default: demo-host-)
//
// ---------------------------------------------------------------------------
// SAFETY
// ---------------------------------------------------------------------------
// PayHold has NO delete-seller endpoint. Every seller this creates is permanent
// in the tenant, next to the real ones, forever. Three guards, in order:
//
//   1. Only ids starting with --prefix (default `demo-host-`) are touched, so a
//      real host's genuine destination can never be overwritten by a fake one.
//   2. A host that already has `payhold_seller_id` is skipped outright.
//   3. Otherwise PayHold is asked by `external_user_id` FIRST and a seller it
//      already has is re-linked, not re-created — the same repair
//      `payhold-register-seller` does. A second registration for one host would
//      orphan the first record, with money possibly owed to it.
//
// Re-running is therefore safe and converges; it does not accumulate sellers.

const DRY_RUN = process.argv.includes('--dry-run');

// A placeholder `acct_…` was tried here and removed. PayHold hands the id
// straight to Stripe, which answers "does not have access to account … (or that
// account does not exist)" — so a made-up connected account cannot register a
// seller, and there is no version of this script that connects a host outside
// the Flutterwave corridors. Only real Connect onboarding can.
const PREFIX = (() => {
  const i = process.argv.indexOf('--prefix');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'demo-host-';
})();

/**
 * Explicit profile ids, instead of the prefix.
 *
 * The prefix guard assumes demo rows are recognisable by their id, which stopped
 * being true once `give-demo-hosts-logins.mjs` turned them into real accounts
 * with auth uuids. Naming rows outright is the honest replacement: it is still
 * a closed set the operator typed, not a pattern that could widen to catch a
 * real host by accident. Whichever is used, a host that already has a seller is
 * skipped, so this cannot overwrite a genuine payout destination.
 */
const IDS = (() => {
  const i = process.argv.indexOf('--ids');
  return i !== -1 && process.argv[i + 1]
    ? process.argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean)
    : null;
})();

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PAYHOLD_BASE_URL = (process.env.PAYHOLD_BASE_URL ?? '').replace(/\/+$/, '');
const PAYHOLD_API_KEY = process.env.PAYHOLD_API_KEY ?? '';

// ---------------------------------------------------------------------------
// The app's own rules, restated
// ---------------------------------------------------------------------------
// Kept in step with web/src/lib/payments.ts and supabase/functions/_shared/
// payhold.ts. The point of this script is rows indistinguishable from ones a
// host produced at /payouts/setup, so it must make the same choices the screen
// would have made for them — a method their market does not offer would be data
// the UI can never generate and the router cannot honour.

/** Markets Flutterwave settles locally — `FLUTTERWAVE_COUNTRIES` in payments.ts. */
const FLUTTERWAVE_COUNTRIES = new Set(['RW', 'KE', 'UG', 'TZ', 'NG', 'GH', 'ZA', 'CI']);

/** `payoutMethodsFor` — MoMo only where it exists; card only where it doesn't. */
function payoutMethodsFor(country) {
  return FLUTTERWAVE_COUNTRIES.has(country) ? ['momo', 'bank'] : ['bank', 'card'];
}

/** `payoutProviderFor` in _shared/payhold.ts — the rail a destination is tokenized against. */
const AFRICAN_PAYOUT = new Set([
  'RW', 'KE', 'UG', 'TZ', 'NG', 'GH', 'ZA', 'CM', 'CI', 'SN', 'ZM', 'ET',
]);
function payholdProviderFor(method, country) {
  if (method === 'momo') return 'flutterwave_momo';
  if (method === 'bank') return AFRICAN_PAYOUT.has(country) ? 'flutterwave_bank' : 'stripe_connect';
  return 'stripe_connect';
}

/**
 * The rails to actually try, best first.
 *
 * `payoutProviderFor` sends card-anywhere and bank-outside-Africa to
 * `stripe_connect`, and PayHold refuses a raw number there: a Stripe
 * destination is an `acct_…` minted by Connect onboarding, which neither side
 * has built. That is a real gap in the product — see docs/payhold.md, "What the
 * first live run found" — and it is not one a seeding script can close, because
 * there is no onboarding to run on a profile with no login.
 *
 * So outside the Flutterwave corridors this falls back to the wallet rails
 * PayHold lists, which take an address rather than an account: a demo host on
 * PayPal is a truthful record of a reachable destination, where a made-up
 * `acct_…` would be a seller that can hold a renter's money and never pay it
 * out — the exact failure the escrow design exists to prevent.
 *
 * Each entry is tried in order and the first PayHold accepts wins; a refused
 * corridor costs nothing but the round trip. China is here on the strength of
 * Alipay/WeChat Pay being in PayHold's own provider list — its bank/card
 * corridor is closed, which is a different question from its wallet corridors.
 */
function railsFor(country, { id, email, phone }) {
  if (AFRICAN_PAYOUT.has(country)) return null; // handled by the momo/bank path
  const wallets = {
    CN: [
      { provider: 'alipay', label: 'Alipay', destination: email },
      { provider: 'wechat_pay', label: 'WeChat Pay', destination: phone },
    ],
    US: [
      { provider: 'paypal', label: 'PayPal', destination: email },
      { provider: 'venmo', label: 'Venmo', destination: phone },
      { provider: 'cash_app_pay', label: 'Cash App', destination: email },
    ],
  };
  return wallets[country] ?? [{ provider: 'paypal', label: 'PayPal', destination: email }];
}

/** What a host in this market is paid in. Matches the listing currencies in 024/026/027. */
const PAYOUT_CURRENCY = { RW: 'RWF', AE: 'AED', CN: 'CNY', US: 'USD' };

/** `METHOD_LABEL` in payhold-register-seller — the label the host sees on file. */
const METHOD_LABEL = { momo: 'Mobile Money', bank: 'Bank', card: 'Card' };

/**
 * `methodForProvider` in payhold-register-seller — which of our three methods a
 * PayHold rail came from. `stripe_connect` is genuinely ambiguous (both a card
 * and a non-African bank land there), so this is only ever used to describe a
 * destination we did not create.
 */
function methodForProvider(provider) {
  if (provider === 'flutterwave_momo') return 'momo';
  if (provider === 'flutterwave_bank') return 'bank';
  return 'card';
}

/**
 * `mask()` in payhold-register-seller — last four digits, nothing usable.
 *
 * Wallet rails take an address rather than an account, and the last four
 * characters of one are meaningless ("••••mple" for anything at .example). An
 * address is masked the way an address is: first letter, then the domain, which
 * is the part a host recognises as theirs.
 */
function mask(destination) {
  const s = destination.replace(/\s+/g, '');
  if (s.includes('@')) {
    const [local, domain] = s.split('@');
    return `${local.slice(0, 1)}••••@${domain}`;
  }
  return `••••${s.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Made-up destinations
// ---------------------------------------------------------------------------
// These are fake by design and must stay fake: a real number here would send a
// demo trip's money to a stranger. Nothing is ever paid out to them — the point
// is only that PayHold has a seller to name, so a deal can open and the escrow
// path can be demonstrated end to end.

/** Card brands rotate too, so the masks on screen differ (••••4242, ••••4444, …). */
const TEST_CARDS = [
  '4242424242424242', // Visa
  '5555555555554444', // Mastercard
  '4000056655665556', // Visa debit
  '378282246310005', // Amex
];

/**
 * MoMo goes to the host's own listed number — it is already a fake in the seed
 * data. Cards and bank accounts are generated from `nth`, the host's position
 * among those assigned THIS method rather than among all hosts: counting
 * globally skips values, and a card list of four consumed at every other index
 * hands the same brand to two hosts. The masks are what a demo shows, so two
 * reading `••••0005` is the whole failure.
 */
function destinationFor({ method, phone, nth }) {
  if (method === 'momo') {
    const digits = (phone ?? '').replace(/\D/g, '');
    return digits.length >= 9 ? digits : `25078${String(8000001 + nth).slice(-7)}`;
  }
  if (method === 'card') return TEST_CARDS[nth % TEST_CARDS.length];
  // Bank: a 10-digit account. Deliberately not near the card numbers, so no two
  // methods can mask to the same last four.
  return String(3000000000 + (nth + 1) * 101010101).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function supa(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    // Callers pass a plain object. Handing that to fetch as-is stringifies it to
    // "[object Object]" and PostgREST rejects the row.
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
  if (!res.ok) throw new Error(`Supabase ${res.status} on ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function payhold(path, init = {}) {
  const res = await fetch(`${PAYHOLD_BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      // Not a bearer token — Authorization on PayHold means a dashboard session.
      'X-Api-Key': PAYHOLD_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const msg = parsed?.error?.message ?? parsed?.message ?? `PayHold returned ${res.status}`;
    throw new Error(`${msg} (${res.status})`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Which market a demo host is in.
 *
 * Their profiles have no `country` — migration 046 added the column long after
 * 024 seeded them, and null there means "never asked". Their LISTINGS do have
 * one, and it is the market whose money must reach them, so it is the right
 * answer rather than a guess. A host with cars in more than one market takes
 * whichever they have most of; the demo hosts each have exactly one.
 */
async function marketFor(hostId) {
  const rows = await supa(
    `/listings?select=country&host_id=eq.${encodeURIComponent(hostId)}&limit=1000`,
  );
  const tally = new Map();
  for (const r of rows) tally.set(r.country, (tally.get(r.country) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Assign the methods.
 *
 * The rotation runs across the whole sorted list rather than per market, so two
 * hosts in the same market never land on the same method — the variety is the
 * point, it is what makes the demo show a MoMo payout, a bank transfer and a
 * card payout side by side instead of eight identical rows. RW gets no card
 * because AutoHire does not offer one there, not because of the rotation.
 */
function assign(hosts) {
  const nth = { momo: 0, bank: 0, card: 0 };
  return hosts.map((host, i) => {
    const wallets = railsFor(host.country, { email: host.email, phone: host.phone });
    const payoutCurrency = PAYOUT_CURRENCY[host.country] ?? null;

    // Outside the Flutterwave corridors, rotate which wallet a host prefers so
    // two in the same market differ, but keep the rest as fallbacks — the point
    // of the list is that a closed corridor is survivable.
    if (wallets) {
      const ordered = wallets.map((_, k) => wallets[(i + k) % wallets.length]);
      return {
        ...host,
        payoutCurrency,
        candidates: ordered.map((w) => ({
          // The local column allows only momo/bank/card, so a wallet is filed
          // as 'card' — the closest of the three. `payout_label` carries the
          // truth, and it is the label the account screen actually shows.
          method: 'card',
          provider: w.provider,
          label: w.label,
          destination: w.destination,
          masked: mask(w.destination),
        })),
      };
    }

    const allowed = payoutMethodsFor(host.country);
    const method = allowed[i % allowed.length];
    const destination = destinationFor({ method, phone: host.phone, nth: nth[method]++ });
    return {
      ...host,
      payoutCurrency,
      candidates: [
        {
          method,
          provider: payholdProviderFor(method, host.country),
          label: METHOD_LABEL[method],
          destination,
          masked: mask(destination),
        },
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  const missing = [
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY],
    ...(DRY_RUN
      ? []
      : [
          ['PAYHOLD_BASE_URL', PAYHOLD_BASE_URL],
          ['PAYHOLD_API_KEY', PAYHOLD_API_KEY],
        ]),
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    console.error(`Missing env: ${missing.join(', ')}`);
    process.exit(1);
  }

  const select =
    '/profiles?select=id,full_name,business_name,role,owner_type,email,phone,country,' +
    'payout_method,payout_status,payhold_seller_id&role=eq.owner';
  const where = IDS
    ? `&id=in.(${IDS.map(encodeURIComponent).join(',')})`
    : `&id=like.${encodeURIComponent(`${PREFIX}*`)}`;

  const profiles = await supa(`${select}${where}&order=id`);
  if (!profiles.length) {
    console.error(
      IDS
        ? `No host profiles matching the ${IDS.length} id(s) given. Nothing to do.`
        : `No host profiles with id like "${PREFIX}…". Nothing to do.`,
    );
    process.exit(1);
  }

  const hosts = [];
  for (const p of profiles) {
    const country = (p.country ?? (await marketFor(p.id)))?.toUpperCase() ?? null;
    if (!country) {
      console.warn(`  skip ${p.id} — no country and no listings to infer one from`);
      continue;
    }
    hosts.push({ ...p, country });
  }

  const planned = assign(hosts);

  console.log(`\n${planned.length} host${planned.length === 1 ? '' : 's'}${DRY_RUN ? ' (dry run)' : ''}\n`);
  for (const h of planned) {
    const already = h.payhold_seller_id ? '  [has seller — will skip]' : '';
    const [first, ...rest] = h.candidates;
    const fallback = rest.length ? `  (else ${rest.map((c) => c.provider).join(', ')})` : '';
    console.log(
      `  ${h.id.padEnd(18)} ${h.country}  ${first.label.padEnd(13)} ${first.masked.padEnd(9)}` +
        `  →  ${first.provider}${fallback}${already}`,
    );
  }
  console.log();

  if (DRY_RUN) {
    console.log('Dry run — PayHold was not called and nothing was written.');
    return;
  }

  let created = 0;
  let relinked = 0;
  let skipped = 0;

  for (const h of planned) {
    const who = h.business_name ?? h.full_name;

    if (h.payhold_seller_id) {
      console.log(`· ${h.id}: already seller ${h.payhold_seller_id} — skipped`);
      skipped++;
      continue;
    }

    try {
      // Ask before creating. PayHold refuses a second registration under the
      // same external_user_id, so without this a re-run after a half-finished
      // pass errors instead of repairing the link it is missing.
      const { sellers = [] } = await payhold(
        `/sellers?external_user_id=${encodeURIComponent(h.id)}`,
      );
      // Checked here, not taken on trust: a PayHold that ignores the filter
      // answers with the tenant's WHOLE list, and row zero of that is somebody
      // else's payout destination.
      let seller = sellers.find((s) => s.external_user_id === h.id) ?? null;
      const isRelink = !!seller;

      // Try each rail until PayHold accepts one. A refused corridor is a 4xx
      // that creates nothing, so the cost of trying is a round trip — and the
      // alternative is a market with no payout method at all.
      let chosen = h.candidates[0];
      if (!seller) {
        const refusals = [];
        for (const c of h.candidates) {
          try {
            const res = await payhold('/sellers', {
              method: 'POST',
              body: {
                name: who,
                country: h.country,
                payout_provider: c.provider,
                destination: c.destination,
                payout_currency: h.payoutCurrency,
                external_user_id: h.id,
              },
            });
            seller = res.seller;
            chosen = c;
            break;
          } catch (e) {
            refusals.push(`${c.provider}: ${e.message}`);
          }
        }
        if (!seller) throw new Error(refusals.join('\n      '));
      }

      // On a re-link the destination above was never tokenized, so the mask AND
      // the method on file must describe PayHold's record, not what we made up.
      // The method we picked belongs to a number that was thrown away.
      const masked = isRelink ? (seller.masked_destination ?? chosen.masked) : chosen.masked;
      const method = isRelink
        ? (h.payout_method ?? methodForProvider(seller.payout_provider))
        : chosen.method;
      const label = isRelink ? (METHOD_LABEL[method] ?? 'Payout') : chosen.label;

      // Not 'active' on our say-so — PayHold decides whether a seller can be
      // paid, and /capabilities is where it says so.
      let status = 'pending';
      try {
        const caps = await payhold(`/sellers/${encodeURIComponent(seller.id)}/capabilities`);
        if (caps?.can_receive_payouts) status = 'active';
      } catch {
        /* capabilities is advisory; the link is what matters */
      }

      await supa(`/profiles?id=eq.${encodeURIComponent(h.id)}`, {
        method: 'PATCH',
        body: {
          // Backfilled from their listings when null — payout routing needs it,
          // and payhold-register-seller refuses without it.
          country: h.country,
          payhold_seller_id: seller.id,
          payout_method: method,
          payout_provider: 'payhold',
          payout_destination: masked,
          // The rail's own name, not the column's. A host filed as 'card'
          // because that is all the constraint allows should still read
          // "PayPal · ••••1234" on their account screen rather than a card they
          // do not have.
          payout_label: `${label} · ${masked}`,
          payout_status: status,
        },
      });

      console.log(
        `${isRelink ? '↺' : '✓'} ${h.id}: ${label} ${masked} → seller ${seller.id} (${status})`,
      );
      isRelink ? relinked++ : created++;
    } catch (e) {
      console.error(`✗ ${h.id}: ${e.message}`);
    }
  }

  console.log(`\n${created} created, ${relinked} re-linked, ${skipped} already done.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
