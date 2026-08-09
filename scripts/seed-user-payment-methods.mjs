#!/usr/bin/env node
// Give every demo user a saved payment method — card and varied.
//
// Payment methods go on the renter side. This seeds them so the account screen
// shows a connected method and bookings can populate the payment field without
// asking the user to type again.
//
//   SUPABASE_URL=https://gsnoggfofbmzamxxyazc.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=… \
//   node scripts/seed-user-payment-methods.mjs --dry-run
//
// Drop --dry-run to write.

const DRY_RUN = process.argv.includes('--dry-run');
const PREFIX = (() => {
  const i = process.argv.indexOf('--prefix');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'user-';
})();

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function supa(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
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
  if (!res.ok) throw new Error(`Supabase ${res.status} on ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const TEST_CARDS = [
  { card: '4242424242424242', brand: 'Visa' },
  { card: '5555555555554444', brand: 'Mastercard' },
  { card: '4000056655665556', brand: 'Visa debit' },
  { card: '378282246310005', brand: 'Amex' },
];

function mask(card) {
  return `••••${card.slice(-4)}`;
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(`Missing env: ${!SUPABASE_URL ? 'SUPABASE_URL' : 'SUPABASE_SERVICE_ROLE_KEY'}`);
    process.exit(1);
  }

  const users = await supa(
    `/profiles?select=id,full_name,role,payment_method,payment_status&role=eq.renter&id=like.${encodeURIComponent(`${PREFIX}*`)}&order=id`,
  );
  if (!users.length) {
    console.error(`No renter profiles with id like "${PREFIX}…". Nothing to do.`);
    process.exit(1);
  }

  const masked = users.map((u, i) => {
    const card = TEST_CARDS[i % TEST_CARDS.length];
    return {
      ...u,
      card: card.card,
      brand: card.brand,
      masked: mask(card.card),
    };
  });

  console.log(`\n${masked.length} renter${masked.length === 1 ? '' : 's'}${DRY_RUN ? ' (dry run)' : ''}\n`);
  for (const u of masked) {
    const already = u.payment_status !== 'none' ? '  [already has method]' : '';
    console.log(`  ${u.id.padEnd(16)} ${u.brand.padEnd(12)} ${u.masked}${already}`);
  }
  console.log();

  if (DRY_RUN) {
    console.log('Dry run — nothing was written.');
    return;
  }

  let created = 0;
  let skipped = 0;

  for (const u of masked) {
    if (u.payment_status !== 'none') {
      console.log(`· ${u.id}: already has method — skipped`);
      skipped++;
      continue;
    }

    try {
      await supa(`/profiles?id=eq.${encodeURIComponent(u.id)}`, {
        method: 'PATCH',
        body: {
          payment_method: 'card',
          payment_destination: mask(u.card),
          payment_label: `${u.brand} · ${mask(u.card)}`,
          payment_status: 'active',
        },
      });
      console.log(`✓ ${u.id}: ${u.brand} ${mask(u.card)} saved`);
      created++;
    } catch (e) {
      console.error(`✗ ${u.id}: ${e.message}`);
    }
  }

  console.log(`\n${created} created, ${skipped} already done.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
