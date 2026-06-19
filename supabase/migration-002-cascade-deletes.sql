-- AutoHire migration 002 — ON DELETE CASCADE on every foreign key.
-- Required for self-serve account deletion: deleting a profile must cascade
-- through all of that user's data. Apply to an existing DB (idempotent: drops
-- each FK by its conventional name, then re-adds it with ON DELETE CASCADE).
--
-- Run AFTER migration-001. The delete-account Edge Function relies on this.

-- listings ------------------------------------------------------------------
alter table listings drop constraint if exists listings_host_id_fkey;
alter table listings add constraint listings_host_id_fkey
  foreign key (host_id) references profiles(id) on delete cascade;

-- bookings ------------------------------------------------------------------
alter table bookings drop constraint if exists bookings_listing_id_fkey;
alter table bookings add constraint bookings_listing_id_fkey
  foreign key (listing_id) references listings(id) on delete cascade;
alter table bookings drop constraint if exists bookings_renter_id_fkey;
alter table bookings add constraint bookings_renter_id_fkey
  foreign key (renter_id) references profiles(id) on delete cascade;
alter table bookings drop constraint if exists bookings_host_id_fkey;
alter table bookings add constraint bookings_host_id_fkey
  foreign key (host_id) references profiles(id) on delete cascade;

-- payouts -------------------------------------------------------------------
alter table payouts drop constraint if exists payouts_booking_id_fkey;
alter table payouts add constraint payouts_booking_id_fkey
  foreign key (booking_id) references bookings(id) on delete cascade;
alter table payouts drop constraint if exists payouts_host_id_fkey;
alter table payouts add constraint payouts_host_id_fkey
  foreign key (host_id) references profiles(id) on delete cascade;

-- conversations -------------------------------------------------------------
alter table conversations drop constraint if exists conversations_listing_id_fkey;
alter table conversations add constraint conversations_listing_id_fkey
  foreign key (listing_id) references listings(id) on delete cascade;
alter table conversations drop constraint if exists conversations_renter_id_fkey;
alter table conversations add constraint conversations_renter_id_fkey
  foreign key (renter_id) references profiles(id) on delete cascade;
alter table conversations drop constraint if exists conversations_host_id_fkey;
alter table conversations add constraint conversations_host_id_fkey
  foreign key (host_id) references profiles(id) on delete cascade;

-- messages ------------------------------------------------------------------
alter table messages drop constraint if exists messages_conversation_id_fkey;
alter table messages add constraint messages_conversation_id_fkey
  foreign key (conversation_id) references conversations(id) on delete cascade;
alter table messages drop constraint if exists messages_sender_id_fkey;
alter table messages add constraint messages_sender_id_fkey
  foreign key (sender_id) references profiles(id) on delete cascade;

-- reviews -------------------------------------------------------------------
alter table reviews drop constraint if exists reviews_booking_id_fkey;
alter table reviews add constraint reviews_booking_id_fkey
  foreign key (booking_id) references bookings(id) on delete cascade;
alter table reviews drop constraint if exists reviews_author_id_fkey;
alter table reviews add constraint reviews_author_id_fkey
  foreign key (author_id) references profiles(id) on delete cascade;
alter table reviews drop constraint if exists reviews_subject_id_fkey;
alter table reviews add constraint reviews_subject_id_fkey
  foreign key (subject_id) references profiles(id) on delete cascade;

-- verification_documents ----------------------------------------------------
alter table verification_documents drop constraint if exists verification_documents_profile_id_fkey;
alter table verification_documents add constraint verification_documents_profile_id_fkey
  foreign key (profile_id) references profiles(id) on delete cascade;

-- notifications -------------------------------------------------------------
alter table notifications drop constraint if exists notifications_profile_id_fkey;
alter table notifications add constraint notifications_profile_id_fkey
  foreign key (profile_id) references profiles(id) on delete cascade;

-- flags ---------------------------------------------------------------------
alter table flags drop constraint if exists flags_reported_by_fkey;
alter table flags add constraint flags_reported_by_fkey
  foreign key (reported_by) references profiles(id) on delete cascade;

-- disputes ------------------------------------------------------------------
alter table disputes drop constraint if exists disputes_booking_id_fkey;
alter table disputes add constraint disputes_booking_id_fkey
  foreign key (booking_id) references bookings(id) on delete cascade;
alter table disputes drop constraint if exists disputes_raised_by_fkey;
alter table disputes add constraint disputes_raised_by_fkey
  foreign key (raised_by) references profiles(id) on delete cascade;
alter table disputes drop constraint if exists disputes_against_fkey;
alter table disputes add constraint disputes_against_fkey
  foreign key (against) references profiles(id) on delete cascade;
