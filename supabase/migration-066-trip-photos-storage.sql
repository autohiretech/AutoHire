-- AutoHire migration 066 — trip-photos storage bucket.
--
-- The composer on a completed trip (TripDetailPage) can now attach photos to
-- a post. Private from the start — unlike avatars/car-photos/kyc-documents,
-- a trip post can be 'private' or 'circles', and a public bucket would let
-- anyone with the URL see a private trip's photos regardless of what
-- trip_posts_read (migration 064) says. The app renders them through
-- short-lived signed URLs, same pattern migration 029 put on chat-files.
--
-- Path convention: <author_id>/<post_id>/<filename>. Two levels, not one,
-- because the read policy needs to answer two different questions: "is this
-- my own upload" (folder [1] = my uid — the ordinary uploader-scoped check
-- every other bucket uses) and, separately, "can I see the POST these photos
-- belong to" (folder [1] = author, folder [2] = post id, checked against
-- trip_posts using the exact same visibility rule trip_posts_read enforces).
-- A single-level path could answer the first question but not the second.
--
-- Photos are uploaded BEFORE the trip_posts row exists — the client generates
-- the post id first, uploads under it, then inserts the row with those paths
-- in `photos`. So the INSERT policy only checks the uploader owns folder [1];
-- it can't yet check anything about a post row that doesn't exist.
--
-- Apply after migration 064 (trip_posts). Safe to re-run.

insert into storage.buckets (id, name, public)
values ('trip-photos', 'trip-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "trip-photos read"   on storage.objects;
drop policy if exists "trip-photos write"  on storage.objects;
drop policy if exists "trip-photos delete" on storage.objects;

create policy "trip-photos read" on storage.objects for select to authenticated
  using (
    bucket_id = 'trip-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from trip_posts tp
        where tp.author_id = (storage.foldername(name))[1]
          and tp.id = (storage.foldername(name))[2]
          and (
            tp.visibility = 'public'
            or (tp.visibility = 'circles' and shares_circle(tp.author_id))
            or is_admin()
          )
      )
    )
  );

create policy "trip-photos write" on storage.objects for insert to authenticated
  with check (bucket_id = 'trip-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "trip-photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'trip-photos' and (storage.foldername(name))[1] = auth.uid()::text);
