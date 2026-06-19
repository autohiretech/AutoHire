-- AutoHire migration 012 — avatars storage bucket.
--
-- Lets every account (personal and company) upload a profile picture. Public
-- bucket so getPublicUrl() works; users can only write inside their own folder.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars read"   on storage.objects;
drop policy if exists "avatars write"  on storage.objects;
drop policy if exists "avatars modify" on storage.objects;
drop policy if exists "avatars delete" on storage.objects;

create policy "avatars read" on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars write" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars modify" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
