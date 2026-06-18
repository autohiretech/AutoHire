# Supabase (Stage B)

Schema + seed for the AutoHire database. IDs are kept as text to match the
hardcoded mock data so the DB starts identical to what the app already shows.

## Apply (Supabase SQL editor)

1. Open your project → **SQL Editor**.
2. Run **`schema.sql`** (creates enums, tables, RLS policies). One-time.
3. Run **`seed.sql`** (inserts the mock data).

## Regenerate the seed

`seed.sql` is generated from `web/src/mocks/data.ts` — don't edit it by hand:

```bash
npx tsx scripts/generate-seed.ts > supabase/seed.sql
```

## ⚠️ RLS is dev-permissive for now

`schema.sql` enables Row-Level Security on every table with **public read** plus
**permissive `*_dev_write` policies** so the app works with the anon key before
auth exists. Replace the `_dev_write` policies with `auth.uid()`-scoped ownership
policies when Supabase Auth lands (ROADMAP Stage B step 4).

## Not wired into the app yet

The app still runs on mock data (`VITE_USE_MOCK=true`). These files just stand up
the database; the `supabaseClient` data layer + the flag flip come next.
