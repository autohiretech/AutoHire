# Supabase (Stage B)

Schema for the AutoHire database. The app is **Supabase-only** — there is no mock
layer or demo seed anymore; the database is the single source of truth, and fresh
signups start empty.

## Files

- **`schema.sql`** — enums, tables, `is_admin()`, and the full auth-scoped RLS.
  Use this to stand up a **fresh** project from scratch.
- **`migration-001-owner-columns-and-admin.sql`** — apply this to an **existing**
  project that already ran an earlier `schema.sql` (it `ALTER`s in the
  `profile_id` owner columns, adds `is_admin()`, and re-applies RLS). `CREATE TABLE`
  in `schema.sql` won't re-run on existing tables, so use the migration instead.

## Apply (Supabase SQL editor)

Open your project → **SQL Editor**, then:

- **Fresh project:** run `schema.sql` once.
- **Existing project:** run `migration-001-owner-columns-and-admin.sql`.

## RLS & roles

RLS is enabled on every table and scoped to `auth.uid()::text` (which equals
`profiles.id`). Public read is granted only where the app needs it (listings,
profiles, reviews). Admin-only views use `is_admin()` — provision an admin with:

```sql
update profiles set role = 'admin' where id = '<your-auth-uid>';
```

## Auth note

Disable **Confirm email** in the Supabase Auth settings for quick testing, or
signup won't return a session.
