// AutoHire — ai-search Edge Function.
//
// The renter's whole interaction with search-and-book (and message-host,
// watchlist, cancel-trip), in one conversational loop — anything the renter
// could do by hand in the app, the assistant can do for them. Turns free
// text ("cheap automatic SUV in Kigali") into the structured ListingFilters
// the app already filters on, and — the same model, the same call — turns
// "book the second one for this weekend" into a booking request once every
// detail it needs is known. Mistral runs here, server-side, so the API key
// never ships to the client. Plain `fetch` against Mistral's REST API rather
// than an SDK — one less npm dependency for the Deno runtime to resolve.
//
// The model never touches money or writes anything itself. Each of
// start_booking / message_host / update_watchlist / cancel_trip is a
// function *declaration* it may call; the client executes the real,
// unmodified app mutation (payhold-create-deal + the checkout modal,
// sendMessage, watchListing/unwatchListing, cancelBooking). The one truly
// financial step — actually paying — still needs a human tapping the pay
// button; nothing here holds a payment method to skip it. The only limit on
// what the assistant can otherwise do is the per-user rate limit below.
//
// Secrets (set in the dashboard → Edge Functions → Secrets, or `supabase secrets set`):
//   MISTRAL_API_KEY   — a key from console.mistral.ai
//
// Deploy:  supabase functions deploy ai-search
//   (JWT verification stays ON — only signed-in app users can call it; this
//   is what stops the endpoint itself, and the Mistral spend behind it, from
//   being open to anyone who isn't a signed-in renter.)

import { createClient } from 'npm:@supabase/supabase-js@2';

// Per-user throttle: this many ai-search calls per window (each is a Mistral
// request, so this caps how fast one account can spend the budget). The only
// guardrail left on what the assistant can do — everything else (which
// listings it can book, message, watchlist, or cancel) is judged by the
// model itself off the context it's given, same as any other assistant.
const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 60;

const MISTRAL_MODEL = 'mistral-small-latest';

const cors = {
  // Set the ALLOWED_ORIGIN secret to your web app's origin in production.
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// Mirrors web/src/lib/cities.ts's COUNTRY_CITIES — every market AutoHire
// holds inventory in, not just Rwanda. Keep the two in sync by hand; there's
// no shared package this Deno function and the Vite app both import from.
const COUNTRY_CITIES: Record<string, string[]> = {
  RW: ['Kigali', 'Musanze', 'Rubavu', 'Huye', 'Rusizi'],
  AE: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman'],
  CN: ['Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen', 'Chengdu'],
  US: [
    'New York', 'Los Angeles', 'San Francisco', 'Chicago', 'Austin',
    'Miami', 'Seattle', 'Denver', 'Boston', 'Atlanta',
  ],
};
const ALL_CITIES = Object.values(COUNTRY_CITIES).flat();
const COUNTRY_NAMES: Record<string, string> = { RW: 'Rwanda', AE: 'UAE', CN: 'China', US: 'United States' };
const CATEGORIES = ['sedan', 'suv', '4x4', 'hatchback', 'pickup', 'van', 'minibus', 'luxury'];

// Mistral's tool-calling schema is OpenAI-shaped: each tool is
// `{ type: 'function', function: { name, description, parameters } }`, and
// `parameters` is plain JSON Schema — unlike Gemini's SDK, no `Type.X` enum
// wrapper, just the string type names.
type ToolDecl = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

// Schema mirrors web/src/lib/types.ts → ListingFilters. All fields optional.
const FILTER_TOOL: ToolDecl = {
  type: 'function',
  function: {
    name: 'apply_filters',
    description: "Apply the search filters that best match the renter's request.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text: make, model, or keywords.' },
        country: {
          type: 'string',
          enum: Object.keys(COUNTRY_CITIES),
          description:
            'Switch market by country code (RW=Rwanda, AE=UAE, CN=China, US=United States) when the ' +
            "renter names a country without a specific city (e.g. \"one in China\"). If they name a " +
            'specific city instead, set `city` and leave this unset — the app resolves the market from it.',
        },
        city: {
          type: 'string',
          enum: ALL_CITIES,
          description: 'Pickup city — switches market automatically if it belongs to a different one than the current filters.',
        },
        category: { type: 'string', enum: CATEGORIES, description: 'Body type.' },
        ownerType: { type: 'string', enum: ['individual', 'business'], description: 'Host type.' },
        transmission: { type: 'string', enum: ['automatic', 'manual'] },
        minSeats: { type: 'integer', description: 'Minimum number of seats.' },
        maxPriceRwf: { type: 'integer', description: 'Maximum price per day in RWF.' },
        clear: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['query', 'country', 'city', 'category', 'ownerType', 'transmission', 'minSeats', 'maxPriceRwf'],
          },
          description:
            "Filter fields to remove entirely. Use this — not just omitting the field — when the " +
            'renter says a constraint no longer applies ("not an suv" → clear: ["category"]; "any ' +
            'price is fine" → clear: ["maxPriceRwf"]). Omitting a field only means "leave it as it ' +
            'is"; it does NOT clear a value set earlier in the conversation.',
        },
      },
    },
  },
};

// Deliberately narrow: only what `payhold-create-deal` actually needs.
const BOOKING_TOOL: ToolDecl = {
  type: 'function',
  function: {
    name: 'start_booking',
    description:
      "Start booking a specific car — call this as soon as you know WHICH car the renter means, " +
      'even if the dates, pickup time, or hours are not known yet. Pass whatever you do know and ' +
      'leave the rest out; the app shows the renter real date/time inputs for anything still ' +
      'missing, so you never need to have every field before calling this, and you never need to ' +
      'list out what\'s missing in your reply — the inputs do that.',
    parameters: {
      type: 'object',
      properties: {
        listingId: {
          type: 'string',
          description: 'The id of the listing to book — from the listings shown, or the id of a specific car the renter named.',
        },
        startDate: { type: 'string', description: 'ISO date, e.g. 2026-08-20, if already known.' },
        endDate: {
          type: 'string',
          description:
            "ISO date, strictly after startDate, if already known — a daily car is picked up one " +
            "day and returned another, never the same day. If the renter only wants it for part of " +
            "a day, that's rentalType 'hourly' instead, not a same-day 'daily' booking.",
        },
        pickupTime: { type: 'string', description: '24-hour HH:mm, e.g. 10:00, if already known.' },
        rentalType: { type: 'string', enum: ['daily', 'hourly'] },
        estimatedHours: { type: 'number', description: 'If already known, and only for an hourly car.' },
      },
      required: ['listingId'],
    },
  },
};

const MESSAGE_HOST_TOOL: ToolDecl = {
  type: 'function',
  function: {
    name: 'message_host',
    description: "Send a message to a listing's host on the renter's behalf.",
    parameters: {
      type: 'object',
      properties: {
        listingId: { type: 'string', description: 'The listing whose host should receive the message.' },
        message: { type: 'string', description: "The message text, written in the renter's voice." },
      },
      required: ['listingId', 'message'],
    },
  },
};

const WATCHLIST_TOOL: ToolDecl = {
  type: 'function',
  function: {
    name: 'update_watchlist',
    description: "Add or remove a listing from the renter's watchlist.",
    parameters: {
      type: 'object',
      properties: {
        listingId: { type: 'string' },
        action: { type: 'string', enum: ['add', 'remove'] },
      },
      required: ['listingId', 'action'],
    },
  },
};

const CANCEL_TRIP_TOOL: ToolDecl = {
  type: 'function',
  function: {
    name: 'cancel_trip',
    description:
      "Cancel one of the renter's own bookings. Only call once the specific trip is unambiguous " +
      '— resolve it against the "Renter\'s own trips" list below (by dates, car, or state).',
    parameters: {
      type: 'object',
      properties: {
        bookingId: { type: 'string', description: "A booking id from the renter's own trips list." },
      },
      required: ['bookingId'],
    },
  },
};

const UPDATE_PROFILE_TOOL: ToolDecl = {
  type: 'function',
  function: {
    name: 'update_profile',
    description:
      "Update the renter's own account — their display name and/or their account country " +
      '(where they pay from, and what the header market defaults to). Only set the fields the ' +
      'renter actually asked to change.',
    parameters: {
      type: 'object',
      properties: {
        fullName: { type: 'string', description: "The renter's new display name." },
        country: {
          type: 'string',
          enum: Object.keys(COUNTRY_CITIES),
          description: 'ISO country code for their account country (RW/AE/CN/US).',
        },
      },
    },
  },
};

const SET_CURRENCY_TOOL: ToolDecl = {
  type: 'function',
  function: {
    name: 'set_currency',
    description: "Change which currency prices are displayed in, from the renter's available currencies list below.",
    parameters: {
      type: 'object',
      properties: {
        currencyCode: { type: 'string', description: 'ISO 4217 currency code, e.g. USD, RWF, AED, CNY.' },
      },
      required: ['currencyCode'],
    },
  },
};

const TOOLS: ToolDecl[] = [
  FILTER_TOOL,
  BOOKING_TOOL,
  MESSAGE_HOST_TOOL,
  WATCHLIST_TOOL,
  CANCEL_TRIP_TOOL,
  UPDATE_PROFILE_TOOL,
  SET_CURRENCY_TOOL,
];

function systemInstruction(
  recentListings: { id: string; title: string; rentalType?: string }[],
  recentTrips: { id: string; listingId: string; startDate: string; endDate: string; state: string }[],
  location: { lat: number; lng: number } | null,
  country: string | null,
  profile: { name: string | null; verification: string | null; accountCountry: string | null } | null,
  availableCurrencies: string[],
  selectedListingId: string | null,
  currentFilters: Record<string, unknown> | null,
): string {
  const listingsBlock = recentListings.length
    ? `\n\nListings shown to the renter so far this conversation:\n${
      recentListings.map((l) => `- ${l.id}: ${l.title}${l.rentalType ? ` (${l.rentalType})` : ''}`).join('\n')
    }`
    : '';
  const tripsBlock = recentTrips.length
    ? `\n\nRenter's own trips (for cancel_trip):\n${
      recentTrips
        .map((t) => `- ${t.id}: listing ${t.listingId}, ${t.startDate} → ${t.endDate} (${t.state})`)
        .join('\n')
    }`
    : '';
  const locationBlock = location
    ? `\n\nRenter's current location: ${location.lat}, ${location.lng}. Use this for "near me" style requests — resolve it to the closest city/area you know and filter accordingly.`
    : '';
  const countryName = country ? COUNTRY_NAMES[country] : null;
  const countryBlock = countryName
    ? `\n\nThe header is currently set to ${countryName} (${country}) — that's the market being searched right now, and prices shown are in whatever currency that market uses. Stay in it unless the renter clearly asks for a different country or names a city in one (then call apply_filters with \`country\` or \`city\` to switch).`
    : '';
  const profileBlock = profile
    ? `\n\nRenter's own account: name "${profile.name ?? 'not set'}", verification status "${
      profile.verification ?? 'unknown'
    }", account country ${profile.accountCountry ?? 'not set'}. Answer questions about their own account (e.g. "am I verified?") directly from this — don't guess, and don't call a tool just to answer a question.`
    : '';
  const currencyBlock = availableCurrencies.length
    ? `\n\nCurrencies the renter can display prices in: ${availableCurrencies.join(', ')}.`
    : '';
  const selectedBlock = selectedListingId
    ? `\n\nThe renter just selected this exact listing (a map pin or similar direct pick): ${selectedListingId}. If they're now asking to book, message the host, or watchlist a car and haven't clearly named a different one, this is the car they mean — use this id directly. Do not ask "which one" when this is set.`
    : '';
  // These may have been set by you in an earlier turn, OR by the renter
  // clicking a filter chip directly in the app — you have no way to tell
  // which, and it doesn't matter. Either way they're genuinely active right
  // now and WILL keep narrowing results even though nothing about them is in
  // this conversation. Without this block you'd have no way to know a stale
  // one is still there silently fighting your new filters down to zero
  // matches while your reply still sounds confident.
  const activeFiltersBlock = currentFilters && Object.keys(currentFilters).length > 0
    ? `\n\nFilters currently active on the results (already applied, not something you need to set again): ${
      JSON.stringify(currentFilters)
    }. If the renter's new request conflicts with any of these — a different vehicle type, city, price range, etc. — you MUST put that field in apply_filters' \`clear\` array. It will NOT clear itself just because you left it out of \`filters\`.`
    : '';

  const today = new Date().toISOString().slice(0, 10);

  return `You are AutoHire's assistant for a peer-to-peer self-drive car rental marketplace, active in multiple countries (Rwanda, UAE, China, United States). You can do anything the renter could do by hand in the app: search, book, message a host, watchlist a car, cancel their own trip, update their own name or account country, or change their display currency.

Today's date is ${today}. Resolve "today", "tomorrow", "this weekend", etc. against this — never guess or fall back on your own training cutoff for what "today" means.

- When the renter is searching or browsing, call apply_filters with whatever their request implies. Leave a field unset rather than guessing. Put make/model names and other free-text keywords in \`query\`. Filters carry over turn to turn — when the renter drops a constraint ("not an suv", "it doesn't have to be electric", "any price is fine"), that field's old value is still active unless you put it in \`clear\`; omitting a field only means you're not changing it right now. This carrying-over isn't limited to filters you set yourself — see the currently-active list below, which can include ones the renter set by clicking a filter chip directly. Check it before every apply_filters call: a genuinely new, different kind of request (a different vehicle type, a different city, dropping a price cap) needs those fields \`clear\`ed explicitly, or they'll keep silently narrowing results alongside whatever you just set.
- When the renter names a country without a specific city ("one in China"), set \`country\`. When they name a specific city, set \`city\` instead and leave \`country\` unset — the app resolves the market from the city either way.
- When the renter asks to book a specific car, call start_booking — but ONLY once every required field is actually known (see that tool's own description). If something is missing, do not call it — ask one short, specific question in your reply to get exactly what's missing, then wait for their answer. rentalType is NOT your choice — each listing below is tagged (daily) or (hourly), and that's the only valid rentalType for it; use whichever the listing is actually tagged, not whatever the renter's phrasing implies. A 'daily' car needs a real multi-day span (endDate after startDate) — "just today" or "this afternoon" on a daily-only car means asking the renter for a real return day, not booking start === end. An 'hourly' car needs estimatedHours, not date-only phrasing.
- When the renter asks to message a host, call message_host with a message that actually reads like something they'd say.
- When the renter asks to save/watch or unsave a car, call update_watchlist.
- When the renter asks to cancel a trip, call cancel_trip, resolving which one against their own trips list below. If it's ambiguous which trip they mean, ask instead of guessing.
- When the renter asks to change their name or account country, call update_profile.
- When the renter asks to change the currency prices are shown in, call set_currency with one of the codes listed below.
- Questions about their own account (verification status, current country, current currency) — answer directly in your reply from the context below. No tool call needed just to read something back.
- Resolve references like "the second one" or "the Clio" against the listings shown below. If several listings genuinely share the exact same title and you have no other way to tell them apart, don't stall on it — just go with the first matching one; a title-identical listing is functionally interchangeable to whoever's booking it.
- Never write an internal id (anything like "demo-car-126") into your reply, for any reason — not to confirm a car, not to disambiguate. The renter never sees ids elsewhere in the app and one means nothing to them. Refer to a car only by its title ("the MG MG4 in Huye"), the same way the renter does.
- Keep replies short and conversational — you're a helpful assistant, not a form. No filler openers ("Sure!", "Great question!", "Certainly,") — start straight with the actual content. When you call start_booking without every field yet, don't ask for the missing ones yourself — the app already shows real date/time inputs for that. A short "Let's get that booked" is enough; the form does the rest.
- Always say something in your reply, even when you also call a tool — a bare tool call with no reply text leaves the renter looking at a blank response.${countryBlock}${profileBlock}${currencyBlock}${selectedBlock}${activeFiltersBlock}${listingsBlock}${tripsBlock}${locationBlock}`;
}

interface HistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

interface MistralToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface MistralResponse {
  choices?: { message?: { content?: string | null; tool_calls?: MistralToolCall[] } }[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const apiKey = Deno.env.get('MISTRAL_API_KEY');
    // Graceful degradation: the client falls back to plain keyword search.
    if (!apiKey) {
      return json({ error: 'AI search is not configured yet (missing MISTRAL_API_KEY).' }, 503);
    }

    const body = await req.json().catch(() => ({}));
    const query = typeof body.query === 'string' ? body.query : '';
    if (!query.trim()) {
      return json({ error: 'A search query is required.' }, 400);
    }
    const history: HistoryTurn[] = Array.isArray(body.history) ? body.history : [];
    const recentListings: { id: string; title: string; rentalType?: string }[] =
      Array.isArray(body.recentListings) ? body.recentListings : [];
    const recentTrips: { id: string; listingId: string; startDate: string; endDate: string; state: string }[] =
      Array.isArray(body.recentTrips) ? body.recentTrips : [];
    const location: { lat: number; lng: number } | null =
      body.location && typeof body.location.lat === 'number' && typeof body.location.lng === 'number'
        ? { lat: body.location.lat, lng: body.location.lng }
        : null;
    const country: string | null = typeof body.country === 'string' ? body.country : null;
    const profile: { name: string | null; verification: string | null; accountCountry: string | null } | null =
      body.profile && typeof body.profile === 'object'
        ? {
          name: typeof body.profile.name === 'string' ? body.profile.name : null,
          verification: typeof body.profile.verification === 'string' ? body.profile.verification : null,
          accountCountry: typeof body.profile.accountCountry === 'string' ? body.profile.accountCountry : null,
        }
        : null;
    const availableCurrencies: string[] = Array.isArray(body.availableCurrencies) ? body.availableCurrencies : [];
    const selectedListingId: string | null =
      typeof body.selectedListingId === 'string' ? body.selectedListingId : null;
    const currentFilters: Record<string, unknown> | null =
      body.currentFilters && typeof body.currentFilters === 'object' ? body.currentFilters : null;

    // Throttle per user (JWT verification is on, so a caller is always present).
    // Fail open only if the identity/limit lookup itself errors — never on a hit.
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: userData } = await admin.auth.getUser(token);
    const identity = userData?.user?.id ?? 'anon';
    const { data: allowed } = await admin.rpc('rate_limit_hit', {
      p_key: `ai-search:${identity}`,
      p_limit: RATE_LIMIT,
      p_window_seconds: RATE_WINDOW_SECONDS,
    });
    if (allowed === false) {
      return json({ error: 'Too many searches. Please wait a moment and try again.' }, 429);
    }

    const messages = [
      {
        role: 'system',
        content: systemInstruction(
          recentListings,
          recentTrips,
          location,
          country,
          profile,
          availableCurrencies,
          selectedListingId,
          currentFilters,
        ),
      },
      ...history.slice(-10).map((t) => ({
        role: t.role === 'assistant' ? 'assistant' : 'user',
        content: t.text.slice(0, 1000),
      })),
      { role: 'user', content: query.slice(0, 500) },
    ];

    const mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MISTRAL_MODEL,
        messages,
        tools: TOOLS,
        // auto, not "any" — the model has to be free to answer in plain text
        // (a clarifying question) instead of calling a function, which is
        // exactly the case a still-incomplete booking request needs.
        tool_choice: 'auto',
      }),
    });

    if (!mistralRes.ok) {
      const errText = await mistralRes.text().catch(() => '');
      console.error('Mistral API error', mistralRes.status, errText);
      return json({ error: 'AI search failed. Try a plain keyword search.' }, 502);
    }

    const data = (await mistralRes.json()) as MistralResponse;
    const message = data.choices?.[0]?.message;
    const toolCalls = message?.tool_calls ?? [];

    function argsFor(name: string): Record<string, unknown> | null {
      const call = toolCalls.find((c) => c.function.name === name);
      if (!call) return null;
      try {
        return JSON.parse(call.function.arguments) as Record<string, unknown>;
      } catch {
        return null;
      }
    }

    // `clear` isn't a real ListingFilters field — it's a separate signal for
    // which fields to actively unset, split out here so the client doesn't
    // have to know this tool's internal shape.
    const filtersArgs = argsFor('apply_filters');
    const clearFilters = Array.isArray(filtersArgs?.clear) ? (filtersArgs.clear as string[]) : [];
    if (filtersArgs) delete filtersArgs.clear;

    return json(
      {
        reply: message?.content?.trim() || null,
        filters: filtersArgs,
        clearFilters,
        booking: argsFor('start_booking'),
        messageHost: argsFor('message_host'),
        watchlist: argsFor('update_watchlist'),
        cancelTrip: argsFor('cancel_trip'),
        updateProfile: argsFor('update_profile'),
        setCurrency: argsFor('set_currency'),
      },
      200,
    );
  } catch (err) {
    console.error('ai-search error', err);
    return json({ error: 'AI search failed. Try a plain keyword search.' }, 500);
  }
});
