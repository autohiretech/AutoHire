# AutoHire — Security

How the app is secured, what's been done, and what still needs a human with
dashboard access. Security is an ongoing posture, not a finished state — revisit
this list on each release.

## Architecture (why it's shaped this way)

- **Frontend** (`web/`) talks to Supabase directly with the **anon key**, which
  is public by design. It is safe *only because Row Level Security (RLS) is the
  real backend* — every table is RLS-guarded.
- **Database** (Postgres + RLS policies + triggers in `supabase/`) is where
  security actually lives. A weak policy here is a broken backend.
- **Privileged operations** run in **Edge Functions** (`supabase/functions/`)
  that hold the `service_role` key server-side: payments, booking creation,
  account deletion, AI search. The browser never sees that key.

A separate Node backend or worker fleet is **not** needed and would only add
attack surface. The one worker pattern in use is scheduled functions
(`refresh-fx-rates`), which is the right tool for periodic jobs.

## Done (migrations 029–030, applied to the hosted project)

- [x] **No self-serve admin / fake verification.** `profile_guard` trigger blocks
      users from editing `role` (to/from admin), `verification`, or their own
      rating. (`migration-029`)
- [x] **Bookings only via `confirm-booking`.** The demo insert policy that let a
      renter set their own price is dropped; price is recomputed server-side.
      (`migration-029`)
- [x] **Email / phone no longer world-readable.** Full `profiles` rows are
      visible only to self, admins, and booking/chat counterparties; public
      browsing uses the `public_profiles` view (no contact info).
      (`migration-029`)
- [x] **Private chat attachments.** `chat-files` bucket is private; the app
      renders via short-lived signed URLs. (`migration-029`)
- [x] **AI-search rate limiting.** 20 calls/user/minute via `rate_limit_hit`,
      so one account can't run up the Anthropic bill. (`migration-030` +
      `functions/ai-search`)
- [x] **CORS lockable.** All Edge Functions read `ALLOWED_ORIGIN` (falls back to
      `*` until the secret is set).

## Done (Edge Functions, deployed to the hosted project)

- [x] **All five functions deployed** with rate limiting (`ai-search`) and the
      `ALLOWED_ORIGIN` CORS change live. Imports moved from `esm.sh` to `npm:`
      specifiers so Supabase's bundler resolves them (the old esm.sh URLs
      referenced a removed `deno.land/std` node-polyfill path and failed to
      deploy).

## TODO — needs dashboard / CLI access (I can't do these from here)

- [ ] **Set the production CORS origin**, then redeploy (until set, CORS is `*`):
      ```sh
      npx supabase secrets set ALLOWED_ORIGIN=https://yourdomain.com
      npx supabase functions deploy
      ```
- [ ] **Set `ANTHROPIC_API_KEY`** when you want AI search live (it returns 503
      until then; the app falls back to keyword search):
      ```sh
      npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
      ```
- [ ] **Auth rate limits** (login / signup / OTP) — Dashboard → Authentication →
      Rate Limits. These are gateway-level and can't be set from code.
- [ ] **Leaked-password protection + MFA** — Dashboard → Authentication →
      Providers / Policies. Free toggles.
- [ ] **Rotate the `service_role` key** if it has ever been pasted outside the
      Edge Function secrets (Dashboard → Project Settings → API).
- [ ] **Confirm email is OFF** only intentionally (see `config.toml`) — decide
      whether production should require email confirmation.

## Routine hygiene

- Run `npm audit` before releases; patch high/critical advisories.
- The anon key in `web/.env` is public and fine to ship. The `service_role`
  key and `STRIPE_SECRET_KEY` must **never** leave Edge Function secrets.
- Applying a new `supabase/migration-*.sql`: paste it into the Supabase SQL
  editor (they're written to be safe to re-run).
