// AutoHire — ai-search Edge Function (Alibaba-style "AI Mode" search).
//
// Turns a renter's natural-language request ("cheap automatic SUV in Kigali for
// 5 people") into the structured ListingFilters the app already filters on, so
// the browser keeps using the normal `listListings` query. Claude runs here, on
// the server, so the API key is never shipped to the client.
//
// Secrets (set in the dashboard → Edge Functions → Secrets, or `supabase secrets set`):
//   ANTHROPIC_API_KEY   — your Anthropic API key (add this when ready)
//
// Deploy:  supabase functions deploy ai-search
//   (JWT verification stays ON — only signed-in app users can call it.)

import Anthropic from 'https://esm.sh/@anthropic-ai/sdk?target=deno';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

const CITIES = ['Kigali', 'Musanze', 'Rubavu', 'Huye', 'Rusizi'];
const CATEGORIES = ['sedan', 'suv', '4x4', 'hatchback', 'pickup', 'van', 'minibus', 'luxury'];

const SYSTEM = `You convert a person's free-text car-rental search into structured filters for a peer-to-peer self-drive car marketplace. Prices are in Rwandan Francs (RWF). Only set a field when the request clearly implies it; leave everything else unset. Put make/model names and other free-text keywords (e.g. "Toyota", "RAV4", "diesel") in \`query\`. Always call the apply_filters tool exactly once.`;

// Schema mirrors web/src/lib/types.ts → ListingFilters. All fields optional.
const FILTER_TOOL = {
  name: 'apply_filters',
  description: "Apply the search filters that best match the renter's request.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free-text: make, model, or keywords.' },
      city: { type: 'string', enum: CITIES, description: 'Pickup city.' },
      category: { type: 'string', enum: CATEGORIES, description: 'Body type.' },
      ownerType: { type: 'string', enum: ['individual', 'business'], description: 'Host type.' },
      transmission: { type: 'string', enum: ['automatic', 'manual'] },
      minSeats: { type: 'integer', description: 'Minimum number of seats.' },
      maxPriceRwf: { type: 'integer', description: 'Maximum price per day in RWF.' },
    },
    additionalProperties: false,
  },
} as const;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    // Graceful degradation: the client falls back to plain keyword search.
    if (!apiKey) {
      return json({ error: 'AI search is not configured yet (missing ANTHROPIC_API_KEY).' }, 503);
    }

    const { query } = await req.json().catch(() => ({ query: '' }));
    if (!query || typeof query !== 'string' || !query.trim()) {
      return json({ error: 'A search query is required.' }, 400);
    }

    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 512,
      system: SYSTEM,
      tools: [FILTER_TOOL],
      tool_choice: { type: 'tool', name: 'apply_filters' },
      messages: [{ role: 'user', content: query.slice(0, 500) }],
    });

    const block = message.content.find((b) => b.type === 'tool_use');
    const filters = (block && 'input' in block ? block.input : {}) as Record<string, unknown>;

    return json({ filters }, 200);
  } catch (err) {
    console.error('ai-search error', err);
    return json({ error: 'AI search failed. Try a plain keyword search.' }, 500);
  }
});
