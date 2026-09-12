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
    fuel?: string;
    minSeats?: number;
    maxPriceRwf?: number;
    startDate?: string;
    endDate?: string;
    nearMe?: boolean;
  },
  /** `note` is present only when `run` had to overrule the model — a city it
   * sent alongside the renter's coordinate, or a `nearMe` there was no
   * location to honour. `loop.ts` feeds the whole result back as the
   * tool_result, so this is how the model finds out what actually happened
   * instead of narrating the call it made. */
  { action: FiltersAction; note?: string }
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
      query: {
        type: 'string',
        description:
          'Free text describing the CAR — make, model, title words. Never a place: an address or district ' +
          'phrase here is split into words that all have to match one listing, so "Gasabo District, City of ' +
          'Kigali" matches nothing at all. A place is `city`, or `nearMe` when it is where the renter is.',
      },
      country: { type: 'string', enum: COUNTRIES },
      city: {
        type: 'string',
        description:
          'A city the renter actually named. A hard boundary, not a hint — cars in every other city are ' +
          'excluded outright. Do not send one alongside `nearMe`, and never derive one from where they are.',
      },
      category: { type: 'string', enum: CATEGORIES },
      ownerType: { type: 'string', enum: ['individual', 'business'] },
      transmission: { type: 'string', enum: ['automatic', 'manual'] },
      // list_listings has always had this and the browse filter bar shows it,
      // so without it here the model could FIND electric cars and then not
      // show the renter the filter it had just searched on.
      fuel: { type: 'string', enum: ['petrol', 'diesel', 'electric', 'hybrid'] },
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
          "Order results by real distance from the renter's own location, nearest first. Use for \"near me\", \"closest\", \"around here\". Only works when their location is known — the system prompt says whether it is. Do NOT guess a city instead, and do not send `city` with it: their coordinate replaces the city, it does not sit beside it.",
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
    let note: string | undefined;
    const near = nearMe ? ctx.userLocation : undefined;
    if (near) {
      filters.nearLat = near.lat;
      filters.nearLng = near.lng;
      // Where the renter is standing beats the name of the city they are
      // standing in, and that has to be true in code. `city` compiles to a
      // hard `.eq()` on the city column — a boundary — so a city sent
      // alongside the coordinate deletes exactly the cars "near me" is
      // asking for: the ones a few minutes away over a district line. The
      // coordinate excludes nothing and only ranks, so it takes the city's
      // place rather than sitting next to it.
      //
      // Asking the model not to send both is not a mechanism, it is a
      // request — the same lesson the `clear` array taught below. It reads
      // "Gasabo District, City of Kigali" in its own location line and
      // reaches for the city name it can see there, so the tool drops it.
      if (typeof rest.city === 'string' && rest.city.trim()) {
        delete filters.city;
        note =
          `The city filter "${rest.city}" was dropped: it was sent with nearMe, and the renter's own ` +
          'coordinate replaces it — a city boundary would have cut away the nearby cars just outside it. ' +
          'These results are ranked by distance from where they actually are, so describe them that way, ' +
          'not as cars in that city.';
      }
    } else if (nearMe) {
      // A silently ignored "near me" is how this agent ends up confidently
      // answering a question it never answered — "here are the closest cars"
      // over a list that is really ordered by rating. Say it out loud.
      note =
        "nearMe had no effect: the renter's location is not known, so nothing was ranked by distance. " +
        'Do not call any of these the closest or the nearest — tell them you need their location, or ask ' +
        'them to name a place.';
    }
    // `replace` tells the client this is the complete desired state, not a
    // patch. The patch-plus-`clear` contract this replaces was more than the
    // available models could hold: asked for "cars in Rusizi" they would set
    // `city: 'Rusizi'` and put `city` in `clear` in the same call, or clear
    // the city they had just been told about. Stating the full set removes
    // the whole class of error — there is nothing left to get out of sync.
    return Promise.resolve({
      action: { type: 'filters', filters, replace: true },
      ...(note ? { note } : {}),
    });
  },
};

/** Cars the model is pointing at — drawn as photo cards on the map and marked
 * in the list, without changing which cars are shown. */
export interface HighlightAction {
  type: 'highlight';
  ids: string[];
}

/**
 * Point at specific cars.
 *
 * The map already draws a highlighted car as a photo card rather than a price
 * pill, and the list marks it — `ResearchField` has applied this action since
 * it was written. Nothing ever sent one, so the model could name three cars in
 * prose while the map treated them like every other result. Naming them here
 * is what makes "this one, and these two if you want a bigger boot" visible.
 *
 * Highlighting is not filtering: everything the renter was looking at stays on
 * screen. Use `apply_filters` to change WHAT is shown and this to say which of
 * it you mean.
 */
export const highlightTool: ToolDef<{ listingIds: string[] }, { action: HighlightAction }> = {
  name: 'highlight',
  description:
    'Point at specific cars you are recommending — they become photo cards on the map and are marked in ' +
    'the list, while everything else stays visible. Send the ids you just named in your answer, best first, ' +
    'at most a handful. This does not filter: to change which cars are shown, use apply_filters. Send an ' +
    'empty list to stop pointing at anything.',
  input_schema: {
    type: 'object',
    properties: {
      listingIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Listing ids from a search you just ran, in the order you would recommend them.',
      },
    },
    required: ['listingIds'],
  },
  scope: 'any',
  effect: 'write',
  summary: (input) =>
    input.listingIds.length === 0
      ? 'Clearing the highlight'
      : `Pointing at ${input.listingIds.length} car${input.listingIds.length === 1 ? '' : 's'}`,
  // eslint-disable-next-line @typescript-eslint/require-await
  async run(_ctx, input) {
    // Capped and de-duplicated: the map draws each of these as a card, and a
    // model that highlights its whole result set turns the map back into the
    // unreadable wall of cards the tiers exist to prevent.
    const ids = [...new Set(input.listingIds)].slice(0, 8);
    const action: HighlightAction = { type: 'highlight', ids };
    return { action };
  },
};

export const ACTION_TOOLS: ToolDef[] = [navigateTool, applyFiltersTool, highlightTool];
