// AutoHire — ai-agent location tests.
//
// The rule under test is one sentence: when the renter's exact coordinate is
// known, it beats any city name. It is here as tests rather than as prompt
// wording because the prompt route was already tried on this agent and made
// things worse — the model behind it cannot hold a multi-part filter contract,
// so "don't send a city with nearMe" has to be something the tools guarantee.
// See the comments in tools/actions.ts and tools/read.ts.

import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@^1.0.0';
import { applyFiltersTool } from '../tools/actions.ts';
import { listListingsTool } from '../tools/read.ts';
import { buildSystemPrompt } from '../prompt.ts';
import { fakeCtx } from './helpers.ts';
import type { ListingSummary } from '../types.ts';

const KIGALI = { lat: -1.9441, lng: 30.0619, label: 'Gasabo District, City of Kigali, Rwanda' };

function filtersOf(result: unknown): Record<string, unknown> {
  return (result as { action: { filters: Record<string, unknown> } }).action.filters;
}
function noteOf(result: unknown): string | undefined {
  return (result as { note?: string }).note;
}

/** Enough of the PostgREST builder for `list_listings` to run against: every
 * chained call records itself and returns the same object, and awaiting it
 * yields the `{ data, error }` shape `tools/db.ts`'s `run()` expects. */
function fakeSupabase(rows: Record<string, unknown>[]) {
  const calls: { rpc?: Record<string, unknown>; eq: [string, unknown][] } = { eq: [] };
  const builder: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
  };
  for (const method of ['select', 'gte', 'lte', 'or', 'order', 'limit']) {
    builder[method] = () => builder;
  }
  builder.eq = (col: string, val: unknown) => {
    calls.eq.push([col, val]);
    return builder;
  };
  const supabase = {
    from: () => builder,
    rpc: (_name: string, args: Record<string, unknown>) => {
      calls.rpc = args;
      return { then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }) };
    },
  };
  return { supabase, calls };
}

const ROW = { id: 'l1', title: 'Toyota RAV4', make: 'Toyota', model: 'RAV4', city: 'Rubavu', country: 'RW' };

Deno.test('apply_filters: a coordinate replaces a city sent with it', async () => {
  const result = await applyFiltersTool.run(fakeCtx({ userLocation: KIGALI }), {
    city: 'Kigali',
    nearMe: true,
  });
  const filters = filtersOf(result);
  assertEquals(filters.city, undefined);
  assertEquals(filters.nearLat, KIGALI.lat);
  assertEquals(filters.nearLng, KIGALI.lng);
  // The model has to be told, or it captions a distance-ranked list as "cars
  // in Kigali" — the constraint it asked for rather than the one it got.
  assertStringIncludes(noteOf(result) ?? '', 'Kigali');
});

Deno.test('apply_filters: a city with no nearMe is left exactly alone', async () => {
  const result = await applyFiltersTool.run(fakeCtx({ userLocation: KIGALI }), { city: 'Rusizi' });
  assertEquals(filtersOf(result), { city: 'Rusizi' });
  assertEquals(noteOf(result), undefined);
});

Deno.test('apply_filters: nearMe with no known location keeps the city and says it was ignored', async () => {
  const result = await applyFiltersTool.run(fakeCtx(), { city: 'Kigali', nearMe: true });
  const filters = filtersOf(result);
  // With no coordinate the city is the only location signal there is, so it
  // stays — dropping it here would lose the search as well as the ranking.
  assertEquals(filters.city, 'Kigali');
  assertEquals(filters.nearLat, undefined);
  assertStringIncludes(noteOf(result) ?? '', 'nearMe had no effect');
});

Deno.test('apply_filters: nearMe never leaks a coordinate the client cannot use', async () => {
  const result = await applyFiltersTool.run(fakeCtx({ userLocation: KIGALI }), { nearMe: true });
  const filters = filtersOf(result);
  assertEquals(filters.nearMe, undefined);
  assertEquals(filters.nearLat, KIGALI.lat);
  assertEquals(noteOf(result), undefined);
});

Deno.test('list_listings: nearMe drops p_city so the boundary cannot cut nearby cars', async () => {
  const { supabase, calls } = fakeSupabase([ROW]);
  const result = await listListingsTool.run(fakeCtx({ supabase: supabase as never, userLocation: KIGALI }), {
    city: 'Kigali',
    nearMe: true,
  });
  assertEquals(calls.rpc?.p_city, null);
  assertEquals(calls.rpc?.p_near_lat, KIGALI.lat);
  assertEquals(calls.rpc?.p_near_lng, KIGALI.lng);
  const wrapped = result as { listings: ListingSummary[]; note: string };
  assertEquals(wrapped.listings.length, 1);
  assertStringIncludes(wrapped.note, 'Kigali');
  // The step line the renter watches must not claim the city that was dropped.
  assert(!listListingsTool.summary({ city: 'Kigali', nearMe: true }, result).includes('Kigali'));
});

Deno.test('list_listings: a city with no nearMe still filters on the city', async () => {
  const { supabase, calls } = fakeSupabase([ROW]);
  const result = await listListingsTool.run(fakeCtx({ supabase: supabase as never }), { city: 'Rusizi' });
  assertEquals(calls.eq.find(([col]) => col === 'city')?.[1], 'Rusizi');
  assert(Array.isArray(result));
  assertStringIncludes(listListingsTool.summary({ city: 'Rusizi' }, result), 'in Rusizi');
});

Deno.test('list_listings: nearMe with no known location reports that it did nothing', async () => {
  const { supabase } = fakeSupabase([ROW]);
  const result = await listListingsTool.run(fakeCtx({ supabase: supabase as never }), { nearMe: true });
  const wrapped = result as { listings: ListingSummary[]; note: string };
  assertEquals(wrapped.listings.length, 1);
  assertStringIncludes(wrapped.note, 'nearMe had no effect');
  // Nothing was sorted by distance, so the step line must not say it was.
  assert(!listListingsTool.summary({ nearMe: true }, result).includes('nearest'));
});

Deno.test('prompt: active filters describe the distance ranking instead of carrying the coordinate', () => {
  const prompt = buildSystemPrompt({
    role: 'renter',
    filters: { category: 'suv', nearLat: KIGALI.lat, nearLng: KIGALI.lng },
    userLocation: KIGALI,
  });
  // The whole point of `nearMe` being a boolean is that the model never holds
  // a lat/lng; the filters dump was quietly handing it one anyway.
  assert(!prompt.includes(String(KIGALI.lat)), 'raw latitude reached the prompt');
  assert(!prompt.includes(String(KIGALI.lng)), 'raw longitude reached the prompt');
  assertStringIncludes(prompt, 'rankedByDistanceFromRenter');
  assertStringIncludes(prompt, 'suv');
});

Deno.test('prompt: says the coordinate replaces a city, not just that it substitutes for one', () => {
  const prompt = buildSystemPrompt({ role: 'renter', userLocation: KIGALI });
  assertStringIncludes(prompt, KIGALI.label);
  assertStringIncludes(prompt, 'never send one alongside it');
});

Deno.test('prompt: no location means say so, not name a city', () => {
  const prompt = buildSystemPrompt({ role: 'renter', country: 'RW' });
  assertStringIncludes(prompt, 'You do NOT know where the renter is');
  assert(!prompt.includes('rankedByDistanceFromRenter'));
});
