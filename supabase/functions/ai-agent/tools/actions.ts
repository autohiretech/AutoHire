// AutoHire — ai-agent client-action tools: navigate & apply_filters.
//
// These touch nothing server-side — they're how the model tells the client
// what to *show*, mirroring what clicking a nav link or a filter chip does
// in the app. `loop.ts` recognizes any tool result shaped
// `{ action: {...} }` and turns it straight into an SSE `action` event, on
// top of the normal `step` event every tool call gets — see loop.ts's
// `actionFromResult`.

import type { ToolDef } from './types.ts';

const CATEGORIES = ['sedan', 'suv', '4x4', 'hatchback', 'pickup', 'van', 'minibus', 'luxury'];
const COUNTRIES = ['RW', 'AE', 'CN', 'US'];

export interface NavigateAction {
  type: 'navigate';
  route: string;
}

export const navigateTool: ToolDef<{ route: string }, { action: NavigateAction }> = {
  name: 'navigate',
  description:
    'Send the user to a screen in the app (e.g. "/watchlist", "/trips", "/messages", "/circles", ' +
    '"/host/listings"). Use this for "take me to..." / "show me my..." requests that are just navigation, ' +
    'not a search.',
  input_schema: {
    type: 'object',
    properties: { route: { type: 'string', description: 'An in-app path, e.g. "/watchlist".' } },
    required: ['route'],
  },
  scope: 'any',
  effect: 'write',
  summary: (input) => `Opening ${input.route}`,
  run(_ctx, input) {
    return Promise.resolve({ action: { type: 'navigate', route: input.route } });
  },
};

export interface FiltersAction {
  type: 'filters';
  /** The complete filter set that should be active after this action —
   * not a patch. See `applyFiltersTool` for why the patch-plus-`clear`
   * contract was dropped. */
  filters: Record<string, unknown>;
  replace: true;
}

export const applyFiltersTool: ToolDef<
  {
    query?: string;
    country?: string;
    city?: string;
    category?: string;
    ownerType?: string;
    transmission?: string;
    minSeats?: number;
    maxPriceRwf?: number;
    startDate?: string;
    endDate?: string;
    nearMe?: boolean;
  },
  { action: FiltersAction }
> = {
  name: 'apply_filters',
  description:
    "Set the renter's search filters — the same fields the browse page's filter bar uses. " +
    'IMPORTANT: this REPLACES the whole filter set. Send every filter that should be active after this ' +
    'call, including ones already on that you want to keep; anything you leave out is switched off. ' +
    'So to add a city to an existing electric filter, send both. To drop the electric filter, send ' +
    'everything except it. There is no separate clear step, and you never need to name a field just to ' +
    'remove it.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      country: { type: 'string', enum: COUNTRIES },
      city: { type: 'string' },
      category: { type: 'string', enum: CATEGORIES },
      ownerType: { type: 'string', enum: ['individual', 'business'] },
      transmission: { type: 'string', enum: ['automatic', 'manual'] },
      minSeats: { type: 'integer' },
      maxPriceRwf: { type: 'integer' },
      startDate: {
        type: 'string',
        description: 'Pickup date, YYYY-MM-DD. Set with endDate. Real availability filtering: listings already booked across the range are excluded.',
      },
      endDate: {
        type: 'string',
        description: 'Return date, YYYY-MM-DD. Set with startDate.',
      },
      nearMe: {
        type: 'boolean',
        description:
          "Order results by real distance from the renter's own location, nearest first. Use for \"near me\", \"closest\", \"around here\". Only works when their location is known — the system prompt says whether it is. Do NOT guess a city instead.",
      },
    },
  },
  scope: 'any',
  effect: 'write',
  summary: (input) => `Updating filters${input.query ? ` — "${input.query}"` : ''}`,
  run(ctx, input) {
    const { nearMe, ...rest } = input;
    // `nearMe` is a boolean to the model and a coordinate pair to the app.
    // The model never sees or invents lat/lng — it only says "near them",
    // and the real coordinate comes from the client's own geolocation, which
    // Postgres then sorts by (migration 075). If we don't have a location,
    // the flag is dropped rather than faked into some default city.
    const filters: Record<string, unknown> = { ...rest };
    if (nearMe && ctx.userLocation) {
      filters.nearLat = ctx.userLocation.lat;
      filters.nearLng = ctx.userLocation.lng;
    }
    // `replace` tells the client this is the complete desired state, not a
    // patch. The patch-plus-`clear` contract this replaces was more than the
    // available models could hold: asked for "cars in Rusizi" they would set
    // `city: 'Rusizi'` and put `city` in `clear` in the same call, or clear
    // the city they had just been told about. Stating the full set removes
    // the whole class of error — there is nothing left to get out of sync.
    return Promise.resolve({ action: { type: 'filters', filters, replace: true } });
  },
};

export const ACTION_TOOLS: ToolDef[] = [navigateTool, applyFiltersTool];
