// AutoHire — refresh-fx-rates Edge Function.
//
// Fetches the day's foreign-exchange rates from a free provider and upserts them
// into the `fx_rates` table (migration-022), so the app can convert car prices
// into the shopper's currency. Runs once a day on a schedule; see the note in
// migration-022 for wiring it to Dashboard cron or pg_cron.
//
// Rates are quoted against USD (rate = units per 1 USD). Provider:
// open.er-api.com (free, no API key). If a day's fetch fails, yesterday's rows
// stay in place — the app never breaks (it reads the newest as_of per currency).
//
// No secrets to set: Supabase injects SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
// Deploy:  supabase functions deploy refresh-fx-rates
//   (JWT verification is off so the scheduler can call it — see config.toml.)

import { createClient } from 'npm:@supabase/supabase-js@2';

// Currencies AutoHire prices/displays in. Keep in sync with web/src/lib/currency.ts.
const CURRENCIES = ['USD', 'RWF', 'AED', 'CNY'];

Deno.serve(async () => {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    if (data.result !== 'success' || !data.rates) {
      throw new Error(`provider error: ${data['error-type'] ?? 'unknown'}`);
    }

    const asOf = new Date().toISOString().slice(0, 10); // yyyy-mm-dd (UTC)
    const rows = CURRENCIES.filter((c) => data.rates[c] != null).map((c) => ({
      base: 'USD',
      quote: c,
      rate: data.rates[c],
      as_of: asOf,
      source: 'open.er-api.com',
      updated_at: new Date().toISOString(),
    }));

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { error } = await admin
      .from('fx_rates')
      .upsert(rows, { onConflict: 'base,quote,as_of' });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, asOf, count: rows.length }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
});
