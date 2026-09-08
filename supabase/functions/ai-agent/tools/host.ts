// AutoHire — ai-agent host tools. Mirrors createListing (trimmed to the
// fields a conversation would realistically supply — photos/features are
// UI-driven uploads, not something to type into chat), updateListing
// (availability/status subset), and createHostBroadcast in
// web/src/lib/supabaseClient.ts.

import type { ToolDef } from './types.ts';
import { mapRow, run } from './db.ts';

const CATEGORIES = ['sedan', 'suv', '4x4', 'hatchback', 'pickup', 'van', 'minibus', 'luxury'];

export const hostCreateListingTool: ToolDef<
  {
    title: string;
    category: string;
    make: string;
    model: string;
    year: number;
    seats: number;
    transmission: 'automatic' | 'manual';
    fuel: 'petrol' | 'diesel' | 'electric' | 'hybrid';
    pricingMode: 'daily' | 'hourly';
    pricePerDayRwf?: number;
    pricePerHourRwf?: number;
    city: string;
    location: string;
    country?: string;
  },
  unknown
> = {
  name: 'host_create_listing',
  description:
    'List a new car for the signed-in host. Photos are not attached through the agent — the listing is ' +
    'created without them and the host adds photos in the app afterward.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      category: { type: 'string', enum: CATEGORIES },
      make: { type: 'string' },
      model: { type: 'string' },
      year: { type: 'integer' },
      seats: { type: 'integer' },
      transmission: { type: 'string', enum: ['automatic', 'manual'] },
      fuel: { type: 'string', enum: ['petrol', 'diesel', 'electric', 'hybrid'] },
      pricingMode: { type: 'string', enum: ['daily', 'hourly'] },
      pricePerDayRwf: { type: 'integer', description: 'Required when pricingMode is daily.' },
      pricePerHourRwf: { type: 'integer', description: 'Required when pricingMode is hourly.' },
      city: { type: 'string' },
      location: { type: 'string' },
      country: { type: 'string' },
    },
    required: ['title', 'category', 'make', 'model', 'year', 'seats', 'transmission', 'fuel', 'pricingMode', 'city', 'location'],
  },
  scope: 'host',
  effect: 'write',
  summary: (input) => `Listing your ${input.make} ${input.model}`,
  async run(ctx, input) {
    const profile = await run(ctx.supabase.from('profiles').select('owner_type').eq('id', ctx.userId).single());
    const ownerType = (profile?.owner_type as string) ?? 'individual';
    const row = await run(
      ctx.supabase.from('listings').insert({
        id: `car-${Date.now()}`,
        title: input.title,
        host_id: ctx.userId,
        owner_type: ownerType,
        category: input.category,
        make: input.make,
        model: input.model,
        year: input.year,
        seats: input.seats,
        transmission: input.transmission,
        fuel: input.fuel,
        pricing_mode: input.pricingMode,
        price_per_day_rwf: input.pricePerDayRwf ?? null,
        price_per_hour_rwf: input.pricePerHourRwf ?? null,
        country: input.country ?? 'RW',
        location: input.location,
        city: input.city,
        photos: [],
        features: [],
        booking_mode: 'request',
        status: 'available',
      }).select('*').single(),
    );
    return mapRow(row);
  },
};

export const hostSetAvailabilityTool: ToolDef<
  { listingId: string; status: 'available' | 'maintenance' | 'unlisted'; maintenanceUntil?: string },
  unknown
> = {
  name: 'host_set_availability',
  description: "Change a listing's availability status (put it in maintenance, unlist it, or make it available again).",
  input_schema: {
    type: 'object',
    properties: {
      listingId: { type: 'string' },
      status: { type: 'string', enum: ['available', 'maintenance', 'unlisted'] },
      maintenanceUntil: { type: 'string', description: 'ISO date; only used when status is maintenance.' },
    },
    required: ['listingId', 'status'],
  },
  scope: 'host',
  effect: 'write',
  summary: (input) => `Setting ${input.listingId} to ${input.status}`,
  async run(ctx, input) {
    const patch: Record<string, unknown> = { status: input.status };
    patch.maintenance_until = input.status === 'maintenance' ? (input.maintenanceUntil ?? null) : null;
    const row = await run(
      ctx.supabase.from('listings').update(patch).eq('id', input.listingId).eq('host_id', ctx.userId).select('*').maybeSingle(),
    );
    return mapRow(row);
  },
};

export const hostBroadcastTool: ToolDef<{ body: string; listingId?: string }, unknown> = {
  name: 'host_broadcast',
  description: 'Post a fleet announcement to followers, optionally about one specific listing.',
  input_schema: {
    type: 'object',
    properties: { body: { type: 'string' }, listingId: { type: 'string' } },
    required: ['body'],
  },
  scope: 'host',
  effect: 'write',
  summary: () => 'Posting a broadcast',
  async run(ctx, input) {
    const row = await run(
      ctx.supabase.from('host_broadcasts')
        .insert({ id: `bcast-${Date.now()}`, host_id: ctx.userId, body: input.body, listing_id: input.listingId ?? null })
        .select('id, host_id, body, listing_id, created_at').single(),
    );
    return mapRow(row);
  },
};

export const HOST_TOOLS: ToolDef[] = [hostCreateListingTool, hostSetAvailabilityTool, hostBroadcastTool];
