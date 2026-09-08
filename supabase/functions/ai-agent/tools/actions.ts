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
  filters: Record<string, unknown>;
  clear: string[];
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
    clear?: string[];
  },
  { action: FiltersAction }
> = {
  name: 'apply_filters',
  description:
    "Apply search filters that best match the renter's request, same fields the browse page's filter bar " +
    "uses. Filters carry over turn to turn — when a constraint no longer applies (\"not an suv\", \"any price " +
    'is fine"), put that field in `clear`; omitting a field only means "leave it as it is", it does NOT clear a ' +
    'value set earlier.',
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
      clear: {
        type: 'array',
        items: { type: 'string', enum: ['query', 'country', 'city', 'category', 'ownerType', 'transmission', 'minSeats', 'maxPriceRwf'] },
      },
    },
  },
  scope: 'any',
  effect: 'write',
  summary: (input) => `Updating filters${input.query ? ` — "${input.query}"` : ''}`,
  run(_ctx, input) {
    const { clear, ...filters } = input;
    return Promise.resolve({ action: { type: 'filters', filters, clear: clear ?? [] } });
  },
};

export const ACTION_TOOLS: ToolDef[] = [navigateTool, applyFiltersTool];
