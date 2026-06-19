-- AutoHire migration 008 — car-photos storage bucket.
--
-- Lets the listing form upload real image FILES (instead of pasted URLs).
-- Files go to a public bucket; the public URL is what's saved in
-- listings.photos, so rendering anywhere downstream is unchanged.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

-- Public bucket so getPublicUrl() works without signed URLs.
insert into storage.buckets (id, name, public)
values ('car-photos', 'car-photos', true)
on conflict (id) do update set public = true;

-- Anyone can read (it's public); only signed-in users can upload/replace/delete,
-- and only within their own user-id folder (path = "<uid>/<file>").
drop policy if exists "car-photos read"   on storage.objects;
drop policy if exists "car-photos write"  on storage.objects;
drop policy if exists "car-photos modify" on storage.objects;
drop policy if exists "car-photos delete" on storage.objects;

create policy "car-photos read" on storage.objects for select
  using (bucket_id = 'car-photos');

create policy "car-photos write" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'car-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "car-photos modify" on storage.objects for update to authenticated
  using (bucket_id = 'car-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "car-photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'car-photos' and (storage.foldername(name))[1] = auth.uid()::text);
