-- AutoHire — seed data generated from web/src/mocks/data.ts. Do not edit by hand.
-- Run schema.sql first, then this file. Safe to re-run (truncates first).

truncate table profiles, listings, bookings, payouts, conversations, messages,
  reviews, verification_documents, notifications, flags, disputes restart identity cascade;

insert into profiles (id, full_name, avatar_url, email, phone, role, joined_at, verification, rating_avg, rating_count, owner_type, business_name, payout_terms, insurance_type, vehicle_count) values
  ('user-1', 'Chris Mugisha', NULL, 'chris@example.rw', '+250788999000', 'renter', '2026-01-05', 'verified', 4.8, 6, NULL, NULL, NULL, NULL, NULL),
  ('host-1', 'Aline Uwase', NULL, 'aline@example.rw', '+250788111222', 'owner', '2025-02-10', 'verified', 4.9, 37, 'individual', NULL, 'per_trip', 'platform_provided', 1),
  ('host-2', 'Jean-Paul Habimana', NULL, 'jp@example.rw', '+250788333444', 'owner', '2024-11-02', 'verified', 4.7, 21, 'individual', NULL, 'per_trip', 'platform_provided', 2),
  ('host-3', 'Kigali Car Rental Self Drive', NULL, 'fleet@kcrsd.rw', '+250788555666', 'owner', '2023-06-18', 'verified', 4.6, 142, 'business', 'Kigali Car Rental Self Drive', 'net_30', 'commercial', 24);

insert into listings (id, title, host_id, owner_type, category, make, model, year, seats, transmission, fuel, price_per_day_rwf, location, city, photos, features, booking_mode, rating_avg, rating_count, blocked_dates) values
  ('car-1', 'Toyota RAV4 — great for Kigali & trips', 'host-1', 'individual', 'suv', 'Toyota', 'RAV4', 2019, 5, 'automatic', 'petrol', 45000, 'Kimihurura, Kigali', 'Kigali', '{"https://images.unsplash.com/photo-1617469767053-d3b523a0b982?auto=format&fit=crop&w=900&q=70","https://images.unsplash.com/photo-1485463611174-f302f6a5c1c9?auto=format&fit=crop&w=900&q=70"}', '{"Air conditioning","Bluetooth","Backup camera","USB charging"}', 'instant', 4.9, 28, '{"2026-06-20","2026-06-21"}'),
  ('car-2', 'Toyota Land Cruiser Prado 4x4', 'host-2', 'individual', '4x4', 'Toyota', 'Land Cruiser Prado', 2017, 7, 'automatic', 'diesel', 85000, 'Nyarutarama, Kigali', 'Kigali', '{"https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=900&q=70","https://images.unsplash.com/photo-1485463611174-f302f6a5c1c9?auto=format&fit=crop&w=900&q=70"}', '{"4WD","Roof rack","Air conditioning","7 seats"}', 'request', 4.7, 15, '{}'),
  ('car-3', 'Suzuki Swift — economical city car', 'host-2', 'individual', 'hatchback', 'Suzuki', 'Swift', 2020, 5, 'manual', 'petrol', 28000, 'Kacyiru, Kigali', 'Kigali', '{"https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=900&q=70"}', '{"Air conditioning","Fuel efficient","Bluetooth"}', 'instant', 4.6, 9, '{}'),
  ('car-4', 'Toyota Hiace — group & tour transport', 'host-3', 'business', 'van', 'Toyota', 'Hiace', 2021, 14, 'manual', 'diesel', 95000, 'Remera, Kigali', 'Kigali', '{"https://images.unsplash.com/photo-1464219789935-c2d9d9aba644?auto=format&fit=crop&w=900&q=70"}', '{"14 seats","Air conditioning","Commercial insurance"}', 'instant', 4.5, 64, '{}'),
  ('car-5', 'Mercedes-Benz C-Class — premium self-drive', 'host-3', 'business', 'luxury', 'Mercedes-Benz', 'C-Class', 2022, 5, 'automatic', 'petrol', 130000, 'Remera, Kigali', 'Kigali', '{"https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=900&q=70","https://images.unsplash.com/photo-1485463611174-f302f6a5c1c9?auto=format&fit=crop&w=900&q=70"}', '{"Leather seats","Air conditioning","Premium audio","Commercial insurance"}', 'request', 4.8, 31, '{}'),
  ('car-6', 'Toyota Hilux — double cab pickup', 'host-3', 'business', 'pickup', 'Toyota', 'Hilux', 2020, 5, 'manual', 'diesel', 70000, 'Remera, Kigali', 'Kigali', '{"https://images.unsplash.com/photo-1559416523-140ddc3d238c?auto=format&fit=crop&w=900&q=70"}', '{"4WD","Cargo bed","Air conditioning"}', 'instant', 4.4, 18, '{}');

insert into bookings (id, listing_id, renter_id, host_id, start_date, end_date, days, state, subtotal_rwf, service_fee_rwf, total_rwf, created_at, check_in, check_out) values
  ('bk-1', 'car-1', 'user-1', 'host-1', '2026-06-20', '2026-06-23', 3, 'confirmed', 135000, 13500, 148500, '2026-06-15T09:30:00Z', NULL, NULL),
  ('bk-2', 'car-4', 'user-1', 'host-3', '2026-05-10', '2026-05-12', 2, 'completed', 190000, 19000, 209000, '2026-05-01T12:00:00Z', '[{"url":"https://images.unsplash.com/photo-1464219789935-c2d9d9aba644?auto=format&fit=crop&w=900&q=70","label":"Front","takenAt":"2026-05-10T08:00:00Z"}]'::jsonb, '[{"url":"https://images.unsplash.com/photo-1464219789935-c2d9d9aba644?auto=format&fit=crop&w=900&q=70","label":"Front","takenAt":"2026-05-12T17:00:00Z"}]'::jsonb),
  ('bk-3', 'car-2', 'user-1', 'host-2', '2026-07-01', '2026-07-05', 4, 'requested', 340000, 34000, 374000, '2026-06-16T15:45:00Z', NULL, NULL),
  ('bk-4', 'car-5', 'user-1', 'host-3', '2026-06-28', '2026-07-01', 3, 'requested', 390000, 39000, 429000, '2026-06-17T11:20:00Z', NULL, NULL),
  ('bk-5', 'car-6', 'user-1', 'host-3', '2026-07-10', '2026-07-12', 2, 'requested', 140000, 14000, 154000, '2026-06-18T08:05:00Z', NULL, NULL),
  ('bk-6', 'car-4', 'user-1', 'host-3', '2026-06-22', '2026-06-25', 3, 'confirmed', 285000, 28500, 313500, '2026-06-14T14:00:00Z', NULL, NULL);

insert into payouts (id, booking_id, host_id, amount_rwf, channel, status, scheduled_for, paid_at) values
  ('po-1', 'bk-2', 'host-3', 190000, 'bank_transfer', 'paid', '2026-05-13', '2026-05-14'),
  ('po-2', 'bk-1', 'host-1', 135000, 'mtn_momo', 'scheduled', '2026-06-24', NULL),
  ('po-3', 'bk-6', 'host-3', 285000, 'bank_transfer', 'scheduled', '2026-06-26', NULL),
  ('po-4', 'bk-2', 'host-3', 95000, 'airtel_money', 'processing', '2026-06-19', NULL);

insert into conversations (id, listing_id, renter_id, host_id, last_message_preview, last_message_at, unread) values
  ('conv-4', 'car-5', 'user-1', 'host-3', 'It''s request-to-book — send a request and I''ll confirm right away.', '2026-06-18T09:40:00Z', 1),
  ('conv-3', 'car-4', 'user-1', 'host-3', 'Self-drive, but we can arrange a driver for an extra fee.', '2026-06-17T15:10:00Z', 0),
  ('conv-1', 'car-1', 'user-1', 'host-1', 'Great, see you at 8am for pickup!', '2026-06-16T18:20:00Z', 1),
  ('conv-2', 'car-2', 'user-1', 'host-2', 'Also happy to do an airport pickup if useful.', '2026-06-16T16:30:00Z', 2),
  ('conv-5', 'car-3', 'user-1', 'host-2', 'Anytime — welcome back! 🙏', '2026-06-12T10:05:00Z', 0);

insert into messages (id, conversation_id, sender_id, body, sent_at, read_at) values
  ('msg-1', 'conv-1', 'user-1', 'Hi Aline, is the RAV4 available this weekend?', '2026-06-16T17:55:00Z', '2026-06-16T18:00:00Z'),
  ('msg-2', 'conv-1', 'host-1', 'Yes it is! You can book instantly.', '2026-06-16T18:05:00Z', '2026-06-16T18:06:00Z'),
  ('msg-3', 'conv-1', 'user-1', 'Booked. What time for pickup?', '2026-06-16T18:15:00Z', '2026-06-16T18:18:00Z'),
  ('msg-4', 'conv-1', 'host-1', 'Great, see you at 8am for pickup!', '2026-06-16T18:20:00Z', NULL),
  ('msg-5', 'conv-2', 'user-1', 'Hi, is the Prado available the first week of July?', '2026-06-16T15:55:00Z', '2026-06-16T16:00:00Z'),
  ('msg-6', 'conv-2', 'host-2', 'Hello! Yes, 1–5 July is open.', '2026-06-16T16:05:00Z', '2026-06-16T16:06:00Z'),
  ('msg-7', 'conv-2', 'user-1', 'Great. Does it have a roof rack for luggage?', '2026-06-16T16:10:00Z', '2026-06-16T16:12:00Z'),
  ('msg-8', 'conv-2', 'host-2', 'Yes, roof rack included. Want me to hold the dates for you?', '2026-06-16T16:28:00Z', NULL),
  ('msg-9', 'conv-2', 'host-2', 'Also happy to do an airport pickup if useful.', '2026-06-16T16:30:00Z', NULL),
  ('msg-10', 'conv-3', 'user-1', 'Hi, I need the Hiace for a group tour to Musanze on the 5th.', '2026-06-17T14:30:00Z', '2026-06-17T14:35:00Z'),
  ('msg-11', 'conv-3', 'host-3', 'Sure, the Hiace seats 14 and is available on the 5th.', '2026-06-17T14:50:00Z', '2026-06-17T14:52:00Z'),
  ('msg-12', 'conv-3', 'user-1', 'Perfect. Is a driver included or self-drive only?', '2026-06-17T15:00:00Z', '2026-06-17T15:05:00Z'),
  ('msg-13', 'conv-3', 'host-3', 'Self-drive, but we can arrange a driver for an extra fee.', '2026-06-17T15:10:00Z', '2026-06-17T15:30:00Z'),
  ('msg-14', 'conv-4', 'user-1', 'Is the C-Class available this weekend?', '2026-06-18T09:20:00Z', '2026-06-18T09:25:00Z'),
  ('msg-15', 'conv-4', 'host-3', 'It''s request-to-book — send a request and I''ll confirm right away.', '2026-06-18T09:40:00Z', NULL),
  ('msg-16', 'conv-5', 'user-1', 'Thanks for the smooth rental last week!', '2026-06-12T09:50:00Z', '2026-06-12T09:55:00Z'),
  ('msg-17', 'conv-5', 'host-2', 'Anytime — welcome back! 🙏', '2026-06-12T10:05:00Z', '2026-06-12T10:10:00Z');

insert into reviews (id, booking_id, author_id, subject_id, direction, rating, body, created_at) values
  ('rv-1', 'bk-2', 'user-1', 'host-3', 'renter_to_host', 5, 'Spotless van, smooth handover. Highly recommend.', '2026-05-13'),
  ('rv-2', 'bk-2', 'host-3', 'user-1', 'host_to_renter', 5, 'Returned the car clean and on time. Welcome back anytime.', '2026-05-13');

insert into verification_documents (id, type, status, file_name, uploaded_at, note, extracted) values
  ('vd-1', 'drivers_license', 'verified', 'drivers-license.jpg', '2026-01-06', NULL, '{"Name":"Chris Mugisha","License No.":"RW-DL-4471288","Expires":"2029-03-01"}'::jsonb),
  ('vd-2', 'national_id', 'pending', 'national-id.jpg', '2026-06-17', NULL, NULL),
  ('vd-3', 'vehicle_registration', 'verified', 'yellow-card-rab123a.pdf', '2026-05-20', NULL, '{"Plate":"RAB 123 A","Make":"Toyota Hiace","Owner":"Kigali Car Rental Self Drive"}'::jsonb),
  ('vd-4', 'insurance_certificate', 'rejected', 'insurance-2025.pdf', '2026-05-20', 'Certificate has expired. Please upload a current proof of insurance.', NULL);

insert into notifications (id, kind, title, body, channels, created_at, read) values
  ('nt-1', 'booking_confirmation', 'Booking confirmed', 'Your Toyota RAV4 booking for 20–23 Jun is confirmed.', '{"sms","push","in_app"}', '2026-06-15T09:31:00Z', false),
  ('nt-2', 'pickup_reminder', 'Pickup tomorrow', 'Reminder: pick up the RAV4 at 8am in Kimihurura.', '{"sms","push"}', '2026-06-19T08:00:00Z', false),
  ('nt-3', 'payout_alert', 'Payout sent', 'RWF 190,000 was sent to your bank account.', '{"sms","in_app"}', '2026-05-14T10:00:00Z', true);

insert into flags (id, target_type, target_id, target_label, reason, detail, reported_by, created_at, status) values
  ('fl-1', 'listing', 'car-5', 'Mercedes-Benz C-Class — premium self-drive', 'inappropriate', 'Photos look like a stock image, not the actual car.', 'user-1', '2026-06-17T10:15:00Z', 'open'),
  ('fl-2', 'user', 'host-2', 'Jean-Paul Habimana', 'fraud', 'Asked to pay outside the platform via mobile money.', 'user-1', '2026-06-16T19:40:00Z', 'open'),
  ('fl-3', 'listing', 'car-3', 'Suzuki Swift — economical city car', 'spam', 'Duplicate listing reported.', 'user-1', '2026-06-10T08:00:00Z', 'dismissed');

insert into disputes (id, booking_id, raised_by, against, reason, amount_rwf, created_at, status) values
  ('dp-1', 'bk-2', 'host-3', 'user-1', 'Scratch on rear bumper at return; claiming repair cost.', 60000, '2026-05-13T09:00:00Z', 'under_review'),
  ('dp-2', 'bk-1', 'user-1', 'host-1', 'Charged a cleaning fee that was not disclosed.', 15000, '2026-06-24T12:00:00Z', 'open');
