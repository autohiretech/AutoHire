/**
 * Generates supabase/seed.sql from the hardcoded mock data, so a fresh Supabase
 * database starts with the same Kigali cars/hosts/bookings the app already shows.
 *
 *   npx tsx scripts/generate-seed.ts > supabase/seed.sql
 *
 * Re-run whenever web/src/mocks/data.ts changes.
 */
import {
  bookings,
  conversations,
  currentUser,
  disputes,
  flags,
  hosts,
  listings,
  messages,
  notifications,
  payouts,
  reviews,
  verificationDocuments,
} from '../web/src/mocks/data';

type Val = string | number | boolean | null | undefined | string[] | object;

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

function lit(v: Val): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return q(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "'{}'"; // empty array; column type casts it
    if (typeof v[0] === 'object') return `${q(JSON.stringify(v))}::jsonb`; // e.g. check-in photos
    // Postgres array string literal '{"a","b"}' — implicitly casts to text[]/date[]/enum[].
    const inner = v
      .map((x) => `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
      .join(',');
    return q(`{${inner}}`);
  }
  return `${q(JSON.stringify(v))}::jsonb`; // objects -> jsonb
}

function insert(table: string, columns: string[], rows: Record<string, Val>[]): string {
  if (rows.length === 0) return '';
  const values = rows
    .map((r) => `  (${columns.map((c) => lit(r[c])).join(', ')})`)
    .join(',\n');
  return `insert into ${table} (${columns.join(', ')}) values\n${values};\n`;
}

const profiles = [
  { ...currentUser, ownerType: null, businessName: null, payoutTerms: null, insuranceType: null, vehicleCount: null },
  ...hosts,
].map((p: any) => ({
  id: p.id,
  full_name: p.fullName,
  avatar_url: p.avatarUrl,
  email: p.email,
  phone: p.phone,
  role: p.role,
  joined_at: p.joinedAt,
  verification: p.verification,
  rating_avg: p.ratingAvg,
  rating_count: p.ratingCount,
  owner_type: p.ownerType ?? null,
  business_name: p.businessName ?? null,
  payout_terms: p.payoutTerms ?? null,
  insurance_type: p.insuranceType ?? null,
  vehicle_count: p.vehicleCount ?? null,
}));

const out: string[] = [
  '-- AutoHire — seed data generated from web/src/mocks/data.ts. Do not edit by hand.',
  '-- Run schema.sql first, then this file. Safe to re-run (truncates first).',
  '',
  'truncate table profiles, listings, bookings, payouts, conversations, messages,',
  '  reviews, verification_documents, notifications, flags, disputes restart identity cascade;',
  '',
  insert('profiles',
    ['id','full_name','avatar_url','email','phone','role','joined_at','verification','rating_avg','rating_count','owner_type','business_name','payout_terms','insurance_type','vehicle_count'],
    profiles),
  insert('listings',
    ['id','title','host_id','owner_type','category','make','model','year','seats','transmission','fuel','price_per_day_rwf','location','city','photos','features','booking_mode','rating_avg','rating_count','blocked_dates'],
    listings.map((l) => ({
      id: l.id, title: l.title, host_id: l.hostId, owner_type: l.ownerType, category: l.category,
      make: l.make, model: l.model, year: l.year, seats: l.seats, transmission: l.transmission,
      fuel: l.fuel, price_per_day_rwf: l.pricePerDayRwf, location: l.location, city: l.city,
      photos: l.photos, features: l.features, booking_mode: l.bookingMode,
      rating_avg: l.ratingAvg, rating_count: l.ratingCount, blocked_dates: l.blockedDates,
    }))),
  insert('bookings',
    ['id','listing_id','renter_id','host_id','start_date','end_date','days','state','subtotal_rwf','service_fee_rwf','total_rwf','created_at','check_in','check_out'],
    bookings.map((b) => ({
      id: b.id, listing_id: b.listingId, renter_id: b.renterId, host_id: b.hostId,
      start_date: b.startDate, end_date: b.endDate, days: b.days, state: b.state,
      subtotal_rwf: b.subtotalRwf, service_fee_rwf: b.serviceFeeRwf, total_rwf: b.totalRwf,
      created_at: b.createdAt, check_in: b.checkIn ?? null, check_out: b.checkOut ?? null,
    }))),
  insert('payouts',
    ['id','booking_id','host_id','amount_rwf','channel','status','scheduled_for','paid_at'],
    payouts.map((p) => ({
      id: p.id, booking_id: p.bookingId, host_id: p.hostId, amount_rwf: p.amountRwf,
      channel: p.channel, status: p.status, scheduled_for: p.scheduledFor, paid_at: p.paidAt ?? null,
    }))),
  insert('conversations',
    ['id','listing_id','renter_id','host_id','last_message_preview','last_message_at','unread'],
    conversations.map((c) => ({
      id: c.id, listing_id: c.listingId, renter_id: c.renterId, host_id: c.hostId,
      last_message_preview: c.lastMessagePreview, last_message_at: c.lastMessageAt, unread: c.unread,
    }))),
  insert('messages',
    ['id','conversation_id','sender_id','body','sent_at','read_at'],
    messages.map((m) => ({
      id: m.id, conversation_id: m.conversationId, sender_id: m.senderId, body: m.body,
      sent_at: m.sentAt, read_at: m.readAt ?? null,
    }))),
  insert('reviews',
    ['id','booking_id','author_id','subject_id','direction','rating','body','created_at'],
    reviews.map((r) => ({
      id: r.id, booking_id: r.bookingId, author_id: r.authorId, subject_id: r.subjectId,
      direction: r.direction, rating: r.rating, body: r.body, created_at: r.createdAt,
    }))),
  insert('verification_documents',
    ['id','type','status','file_name','uploaded_at','note','extracted'],
    verificationDocuments.map((d) => ({
      id: d.id, type: d.type, status: d.status, file_name: d.fileName ?? null,
      uploaded_at: d.uploadedAt ?? null, note: d.note ?? null, extracted: d.extracted ?? null,
    }))),
  insert('notifications',
    ['id','kind','title','body','channels','created_at','read'],
    notifications.map((n) => ({
      id: n.id, kind: n.kind, title: n.title, body: n.body, channels: n.channels,
      created_at: n.createdAt, read: n.read,
    }))),
  insert('flags',
    ['id','target_type','target_id','target_label','reason','detail','reported_by','created_at','status'],
    flags.map((f) => ({
      id: f.id, target_type: f.targetType, target_id: f.targetId, target_label: f.targetLabel,
      reason: f.reason, detail: f.detail, reported_by: f.reportedBy, created_at: f.createdAt, status: f.status,
    }))),
  insert('disputes',
    ['id','booking_id','raised_by','against','reason','amount_rwf','created_at','status'],
    disputes.map((d) => ({
      id: d.id, booking_id: d.bookingId, raised_by: d.raisedBy, against: d.against,
      reason: d.reason, amount_rwf: d.amountRwf, created_at: d.createdAt, status: d.status,
    }))),
];

process.stdout.write(out.join('\n'));
