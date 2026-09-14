// AutoHire — vehicle-catalogue Edge Function.
//
// What vehicles exist, in three answers: the fleet AutoHire actually has, a
// world catalogue to search, and "is this car real?".
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// The listing form's model picker read a hardcoded array — `carModels.ts`, 57
// curated cars, written when AutoHire rented only cars. Production carries 44
// distinct make+model pairs and 23 of them are not in that array: Caterpillar
// 320 and 950 GC and D6 XE, John Deere S780 and Sesam EV, Grove GMK3060, Hyster
// J1.6XN, Fendt e100 Vario, EGO Power+ Tiller. The page itself says "rent out a
// car, a tractor or an excavator" and `CarCategory` has had `excavator`,
// `crane` and `harvester` in it all along — the picker was the last thing still
// pretending this was cars only, and a host with a bulldozer got an empty
// dropdown and typed every field by hand.
//
// The other half is the opposite failure. `Ferrari 2000 / Y` and `Lamborghini
// Model4` are live listings in production today. Neither is a car. Nothing
// anywhere checked, because nothing anywhere knew what a real model was.
//
// ---------------------------------------------------------------------------
// THE THREE LAYERS, AND WHICH ONE WINS WHAT
//
//   1. AutoHire's own `listings` — authoritative for FUEL, CATEGORY and for
//      MACHINERY EXISTING AT ALL. It is the only source on earth that knows a
//      Grove GMK3060 is a crane, and the only one carrying real fuel/category.
//      It wins every conflict about what a vehicle IS.
//   2. Wikidata — authoritative for WHETHER A CAR EXISTS, and the breadth
//      behind search: 13,481 car models under `wd:Q3231690`, another 438 model
//      series under `wd:Q59773381`, 207 tractors under `wd:Q39495`. Global, not
//      American: it has Toyota Vitz, Chery A1/QQ/Tiggo and Haval, all of which
//      NHTSA vPIC lacks.
//
//   **The listings layer must never launder a fake car into layer 2's answer.**
//   `Ferrari 2000 / Y` is in `listings`; it is not a car; it must not become one
//   because a host typed it. So `knownCar()` below reads the Wikidata index and
//   ONLY the Wikidata index. That separation is the entire point of having two
//   layers and is enforced in one place, `knownCar()`, rather than by anyone
//   remembering it at a call site.
//
//   3. `carModels.ts` stays client-side as a seed for models nobody has listed
//      yet (see `web/src/lib/vehicleCatalogue.ts`).
//
// WHAT WIKIDATA DOES NOT COVER: machinery beyond tractors. Excavators, cranes
// and forklifts are not modelled there as instances of a model class — a count
// under the excavator class returns 0 — so there is no dataset behind them and
// the UI rule is split accordingly: cars must be chosen from the catalogue,
// machinery is free text. Do not go hunting for a machinery class here; it was
// checked.
//
// WHY NOT NHTSA vPIC: it is US *registration* data.
// `GetModelsForMake/toyota` returns 58 models and contains no Vitz, no Hilux
// and no Land Cruiser Prado — two of those are already listed here — plus no
// Chery, no Haval, and no machinery of any kind. It also carries neither fuel
// nor category, so it could never answer "is this model electric?", which is
// the question the picker exists to answer. It adds nothing on top of layer 2.
//
// OVER-INCLUSION IS DELIBERATE, on the car side. A real model missing from the
// index becomes a car somebody genuinely owns and cannot list — worse than a
// fake slipping through, which is only worse data. So `knownCar()` matches
// loosely on purpose (see its comment), and the catalogue is pulled with the
// widest class union that still means "model of car".
//
// AUTH: there is deliberately no `auth.getUser()` here, and deliberately no
// `verify_jwt = false` in config.toml either — the same shape as
// `payhold-catalogue`. The gateway's JWT check stays ON and is satisfied by the
// app's *anon* key, which supabase-js already sends as the Authorization header
// when nobody is signed in. Turning the gateway check off would open this to
// the open internet for no gain and would have to be remembered on every
// redeploy.
//
// Routes (all GET)
//   /vehicle-catalogue                      { entries, listing_count }  — the fleet
//   /vehicle-catalogue?q=corol&limit=20     { entries, query }          — world search
//   /vehicle-catalogue?known=car&make=&model=  { known, matched, entry } — car check
//
// Secrets:  SUPABASE_URL, SUPABASE_ANON_KEY (both injected by the platform)
// Deploy:   supabase functions deploy vehicle-catalogue

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

/**
 * `cacheSeconds = 0` says **no-store**, not "say nothing" — the same rule as in
 * `payhold-catalogue`. A 200 with no `Cache-Control` may be cached
 * heuristically for an unknown length, which is the one thing the error and
 * stale paths below must not be.
 *
 * `public` rather than `private`: every reply here is identical for every
 * caller and derived from nobody's session — the fleet layer is an aggregate
 * over rows any visitor can already read one at a time on /search, and the
 * other two layers are a copy of Wikidata. That is only true because of what
 * the queries below select; the moment anything per-listing or per-host appears
 * in a body, this has to go back to `private`.
 */
function json(body: unknown, status: number, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Cache-Control': cacheSeconds ? `public, max-age=${cacheSeconds}` : 'no-store',
    },
  });
}

export interface CatalogueEntry {
  make: string;
  model: string;
  fuel: string | null;
  category: string | null;
  /** How many listings back this entry. 0 for anything not from the fleet. */
  count: number;
  source: 'autohire' | 'wikidata';
}

/** Whitespace- and case-insensitive form. Internal runs of spaces collapse too. */
function norm(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Letters and digits only.
 *
 * This is what makes "MG4" find "MG 4 EV" and "Ioniq5" find "Ioniq 5". Hosts do
 * not type a catalogue's spacing, and the failure it prevents is the expensive
 * one: a host with a real MG4 told their car does not exist.
 */
function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ===========================================================================
// LAYER 1 — AutoHire's own listings
// ===========================================================================

/**
 * One in-memory copy per warm instance.
 *
 * The fleet changes when a host publishes a car, not when a form is opened, and
 * this sits on the load path of a page every host visits. Fifteen minutes is
 * short enough that a host who lists the platform's first Chery sees it offered
 * to the next host the same hour, and nothing here gates a decision that has to
 * be right to the second.
 */
const FLEET_TTL_MS = 15 * 60 * 1000;
let fleetCache: { at: number; value: Fleet } | null = null;

interface Fleet {
  entries: CatalogueEntry[];
  listing_count: number;
}

/**
 * PostgREST caps a response at 1000 rows whatever you ask for, so this pages
 * rather than trusting one request. Production is at 858 listings today, close
 * enough to the cap that a single `.limit(5000)` would have looked correct for
 * weeks and then silently started truncating the catalogue — the failure would
 * show up as models *disappearing* from the picker as the platform grew, which
 * is the last place anyone would look.
 */
const PAGE = 1000;

type ListingRow = {
  make: string | null;
  model: string | null;
  fuel: string | null;
  category: string | null;
};

async function loadListings(): Promise<ListingRow[]> {
  // The ANON key, not the service role. This function reads nothing a signed-out
  // visitor cannot already read, and using the anon key is what *guarantees*
  // that rather than merely intending it: the query runs under the same RLS the
  // browser gets, so a listing policy that hides rows tomorrow hides them here
  // too, with no second place to remember.
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const rows: ListingRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('listings')
      // No status filter. A car in `maintenance` still proves its model exists,
      // and the catalogue answers "what kind of thing is this?", not "can I
      // book it?". Filtering on status would make the picker's contents move
      // with the rental calendar — a host would find a model on Monday and not
      // on Tuesday because somebody else's machine went in for a service.
      .select('make, model, fuel, category')
      .order('make', { ascending: true })
      .order('model', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as ListingRow[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/**
 * The value most listings of this model use, ties broken alphabetically.
 *
 * Real listings disagree: production has ten Toyota Priuses, six recorded
 * `hybrid` and four `petrol`. Somebody is wrong — there is no petrol-only
 * Prius — and the catalogue has to answer with one of them, because the whole
 * point is auto-filling the field.
 *
 * PLURALITY, not first-seen and not most-recent:
 *   • First-seen is whatever order Postgres felt like returning, which makes
 *     the answer change under an unrelated index change. That is the "silently
 *     picked the first one" failure this function is written to avoid.
 *   • Most-recent would be the better rule — a model that genuinely switches
 *     powertrain should follow the new listings — but `listings` HAS NO
 *     `created_at` COLUMN (checked: PostgREST answers 42703 for it), so recency
 *     is not knowable here. Pretending to implement it by ordering on `id`
 *     would be inventing a fact the table does not carry.
 *   • Plurality is the one rule the data actually supports, and it self-corrects:
 *     the more hosts list a model correctly, the harder a typo is to outvote.
 * The alphabetical tie-break is not meaningful, it is only *stable* — a 5/5
 * split must not flip between two requests, or the form would fill differently
 * for two hosts looking at the same model a second apart.
 */
function plurality(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [value, n] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (n > bestN) {
      best = value;
      bestN = n;
    }
  }
  return best;
}

/**
 * Exported so the aggregation can be run against a real dump of `listings`
 * without deploying anything. The conflict rules above are the part of this
 * function that can be *wrong* rather than merely broken, and "we reasoned
 * about it" is not how you find out that Prius splits 6/4.
 */
export function aggregate(rows: ListingRow[]): Fleet {
  const groups = new Map<
    string,
    { make: string; model: string; count: number; fuel: Map<string, number>; category: Map<string, number> }
  >();

  for (const row of rows) {
    const make = (row.make ?? '').trim();
    const model = (row.model ?? '').trim();
    // A listing with no make or no model cannot name a catalogue entry. It is
    // skipped rather than defaulted: an entry called "" would sit at the top of
    // an alphabetical picker forever.
    if (!make || !model) continue;

    const k = `${norm(make)} ${norm(model)}`;
    let g = groups.get(k);
    if (!g) {
      // The first spelling seen wins the DISPLAY casing, and the rows are
      // ordered by make/model above so that "first" is deterministic across
      // requests. Only the display text is affected — grouping is already
      // case-insensitive, so "toyota corolla" and "Toyota Corolla" are one
      // entry counted twice, not two entries counted once each.
      g = { make, model, count: 0, fuel: new Map(), category: new Map() };
      groups.set(k, g);
    }
    g.count += 1;
    if (row.fuel) g.fuel.set(row.fuel, (g.fuel.get(row.fuel) ?? 0) + 1);
    if (row.category) g.category.set(row.category, (g.category.get(row.category) ?? 0) + 1);
  }

  // Best-known first: the models the platform has most of are the ones the next
  // host is most likely to be listing. Ties fall back to alphabetical so the
  // long tail of one-listing machines is browsable rather than arbitrary.
  const entries: CatalogueEntry[] = [...groups.values()]
    .map((g) => ({
      make: g.make,
      model: g.model,
      fuel: plurality(g.fuel),
      category: plurality(g.category),
      count: g.count,
      source: 'autohire' as const,
    }))
    .sort((a, b) => b.count - a.count || `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`));

  return { entries, listing_count: rows.length };
}

async function fleet(): Promise<{ value: Fleet; from: 'memory' | 'listings' }> {
  if (fleetCache && Date.now() - fleetCache.at < FLEET_TTL_MS) {
    return { value: fleetCache.value, from: 'memory' };
  }
  const value = aggregate(await loadListings());
  fleetCache = { at: Date.now(), value };
  return { value, from: 'listings' };
}

// ===========================================================================
// LAYER 2 — Wikidata
// ===========================================================================

const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';

/**
 * Wikidata blocks generic agents outright, so this must say who we are. No
 * personal contact goes in it — the site is the contact.
 */
const WIKIDATA_UA = 'AutoHireVehicleCatalogue/1.0 (https://autohiretech.pages.dev)';

/**
 * The classes pulled, and why each one is here rather than a tidier single
 * query. All three were counted against the live endpoint before being written
 * down:
 *   • Q3231690  "car model"         — 13,481 items. The main catalogue.
 *   • Q59773381 "car model series"  — 438 items. NOT optional: Nissan Patrol is
 *     a `car model series` and nothing else, so a query on Q3231690 alone tells
 *     a host with a Patrol — a car this platform already rents eight of — that
 *     their car does not exist.
 *   • Q39495    "tractor"           — 207 items. The one machinery class
 *     Wikidata models usefully. Excavators, cranes and forklifts return
 *     nothing; that is why the UI rule is cars-must-match, machinery-free-text.
 *
 * Three requests rather than one UNION because the union takes 42s against
 * Wikidata's 60s limit while the three take 8s, 5s and 2s — and they are issued
 * in parallel with `allSettled`, so a timeout on the tractors still leaves
 * every car in the index. One query is one point of failure for all of it.
 */
const WIKIDATA_CLASSES: {
  qid: string;
  what: string;
  kind: 'car' | 'tractor';
  /** Without this class the index cannot answer "is this a real car?". */
  required: boolean;
}[] = [
  { qid: 'Q3231690', what: 'car model', kind: 'car', required: true },
  { qid: 'Q59773381', what: 'car model series', kind: 'car', required: false },
  { qid: 'Q39495', what: 'tractor', kind: 'tractor', required: false },
];

/**
 * Wikidata's `powered by` (P516) values, mapped by QID and not by label.
 *
 * Every QID here was read off a live `GROUP BY ?fuel` over the car classes with
 * its item count, so this is the real distribution and not a guess: gasoline
 * engine 3,861, electric motor 195, diesel engine 158, Otto engine 17, and the
 * hybrid family in low single figures. QIDs rather than labels because an
 * English label is editable by anyone and a QID is not — a rename on Wikidata
 * would otherwise silently turn every petrol car into an unknown.
 *
 * Anything not listed — `V8`, `straight-four engine`, `Toyota GR engine` and a
 * long tail of engine families — maps to null. They describe an engine, not a
 * fuel, and guessing "V8 means petrol" would be exactly the invention this
 * catalogue is meant to replace.
 */
const WIKIDATA_FUEL: Record<string, string> = {
  Q502048: 'petrol', // gasoline engine
  Q3507866: 'petrol', // Otto engine
  Q174174: 'diesel', // diesel engine
  Q72313: 'electric', // electric motor
  Q734949: 'electric', // brushless DC electric motor
  Q193692: 'electric', // electric car
  Q25659662: 'electric', // DC electric machine
  Q193075: 'hybrid', // hybrid vehicle
  Q5953345: 'hybrid', // hybrid vehicle drivetrain
  Q1483388: 'hybrid', // plug-in hybrid
  Q11083590: 'hybrid', // hybrid electric vehicle
};

interface WikiEntry {
  make: string;
  model: string;
  /** The Wikidata label as written, e.g. "Toyota Land Cruiser Prado (J150)". */
  label: string;
  fuel: string | null;
  kind: 'car' | 'tractor';
  /** Normalised forms this entry answers to — the label, and make+model. */
  keys: string[];
  /** The same keys with spacing and punctuation removed. */
  squashed: string[];
}

interface WikiIndex {
  entries: WikiEntry[];
  /** Which classes actually answered — a partial index is still served. */
  classes: string[];
  /**
   * Whether every REQUIRED class answered.
   *
   * This flag exists because of a failure seen while testing: the 13,481-model
   * `car model` query timed out while the two small classes returned, and the
   * index came back holding 438 model series and 207 tractors. Search still
   * worked, so nothing looked broken — but `knownCar` confidently answered "no
   * such car" for Tesla Model 3, Toyota Vitz and Chery QQ, which on the car
   * side means refusing a host's real car. A partial index is fine to search
   * and must never be used to say no.
   */
  complete: boolean;
}

function sparql(qid: string): string {
  // P1716 (brand) FIRST, P176 (manufacturer) second. Manufacturer is the legal
  // owner and reads as one: "General Motors" for a Corvette, "BMW Group" for an
  // i4, "Mercedes-Benz Group" for an EQB. Brand is the word a host actually
  // types. Where both exist the brand wins; where neither does, the label is
  // split on its first word, because "BMW i4" carries its own make even when
  // the item's only manufacturer statement says "BMW Group".
  return `SELECT ?itemLabel ?brandLabel ?makeLabel ?fuel WHERE {
  ?item wdt:P31/wdt:P279* wd:${qid} .
  OPTIONAL { ?item wdt:P1716 ?brand }
  OPTIONAL { ?item wdt:P176 ?make }
  OPTIONAL { ?item wdt:P516 ?fuel }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}`;
}

type Binding = Record<string, { value: string } | undefined>;

async function fetchClass(qid: string): Promise<Binding[]> {
  const url = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(sparql(qid))}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': WIKIDATA_UA },
    // Wikidata's own ceiling is 60s. Giving up at 45 leaves the other classes
    // time to finish inside one request rather than taking the whole build
    // down with the slowest query.
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Wikidata ${qid} answered ${res.status}`);
  const body = (await res.json()) as { results?: { bindings?: Binding[] } };
  return body.results?.bindings ?? [];
}

/** A label the label-service could not resolve comes back as the bare QID. */
const BARE_QID = /^Q\d+$/;

function value(b: Binding, key: string): string | null {
  const v = b[key]?.value?.trim();
  return v && !BARE_QID.test(v) ? v : null;
}

/**
 * Turn raw SPARQL rows into make+model entries.
 *
 * The hard part is that Wikidata has no "model name" field — it has a label
 * ("Toyota Land Cruiser Prado"), a brand and a manufacturer, and the label
 * usually but not always starts with one of them. The three rules below are in
 * priority order and each one was measured against the real 15,154-row pull:
 *   1. label starts with its own brand/manufacturer → split there.
 *   2. label starts with ANY brand or manufacturer name seen anywhere in the
 *      pull, longest first → split there. This is what rescues "Chevrolet
 *      Corvette", whose only manufacturer statement says "General Motors".
 *   3. otherwise split on the first word. Crude, and it produces the odd
 *      nonsense make, but it is the label's own text rather than an invention,
 *      and it is what keeps "BMW i4" reading as BMW + i4 instead of borrowing
 *      "BMW Group" off the manufacturer statement. On the car side an extra
 *      junk entry is cheaper than a missing real one.
 *   4. a one-word label falls back to its manufacturer, which is the only
 *      thing left that can name a make.
 */
// Exported, like `aggregate` above and `search`/`knownCar` below, so the parts
// that can be *wrong* rather than merely broken can be run against a real
// Wikidata dump without deploying. The split rules are guesses about how a
// crowd-edited catalogue is shaped; the only way to know is to run them over
// all 15,154 rows and read the output.
export function buildEntries(rows: { binding: Binding; kind: 'car' | 'tractor' }[]): WikiEntry[] {
  // Normalised maker name → the name as written. A MAP, looked up by word
  // prefix, and not a list scanned longest-first — that version was written
  // first and measured at over twenty seconds for one build, because 13,776
  // labels × ~2,000 maker names × a `norm()` allocation each is 27 million
  // string operations. Twenty CPU-seconds is not a slow function on Supabase's
  // runtime, it is a KILLED one: the request is cut off at its CPU ceiling and
  // the picker never gets an index at all. Six map lookups per label is the
  // same answer for a thousandth of the work.
  const vocabulary = new Map<string, string>();
  for (const { binding } of rows) {
    for (const key of ['brandLabel', 'makeLabel']) {
      const v = value(binding, key);
      if (v && v.length >= 2 && !vocabulary.has(norm(v))) vocabulary.set(norm(v), v);
    }
  }
  /** No maker name in the data is longer than this many words. */
  const MAX_MAKE_WORDS = 6;

  // One item appears once per brand × manufacturer × fuel combination, so the
  // rows are folded by label first. 15,154 rows collapse to 13,776 items.
  const items = new Map<
    string,
    { label: string; kind: 'car' | 'tractor'; makes: string[]; fuels: Set<string> }
  >();
  for (const { binding, kind } of rows) {
    const label = value(binding, 'itemLabel');
    if (!label) continue;
    let item = items.get(label);
    if (!item) {
      item = { label, kind, makes: [], fuels: new Set() };
      items.set(label, item);
    }
    // A car that is also in the tractor class stays a car; `kind` only ever
    // narrows what `knownCar` will look at, and cars are the checked side.
    if (kind === 'car') item.kind = 'car';
    for (const key of ['brandLabel', 'makeLabel']) {
      const v = value(binding, key);
      if (v && !item.makes.includes(v)) item.makes.push(v);
    }
    const fuel = binding.fuel?.value?.split('/').pop();
    if (fuel && WIKIDATA_FUEL[fuel]) item.fuels.add(WIKIDATA_FUEL[fuel]);
  }

  const entries: WikiEntry[] = [];
  for (const item of items.values()) {
    let make: string | null = null;
    let model = item.label;
    const normLabel = norm(item.label);
    // 1. the item's own brand, then its own manufacturer.
    for (const candidate of item.makes) {
      if (normLabel.startsWith(norm(candidate) + ' ')) {
        make = candidate;
        model = item.label.slice(candidate.length).trim();
        break;
      }
    }
    // 2. any maker name seen anywhere in the pull, longest prefix first.
    if (!make) {
      const words = item.label.split(/\s+/);
      for (let n = Math.min(MAX_MAKE_WORDS, words.length - 1); n >= 1; n--) {
        const hit = vocabulary.get(norm(words.slice(0, n).join(' ')));
        if (hit) {
          make = hit;
          model = words.slice(n).join(' ');
          break;
        }
      }
    }
    if (!make) {
      const space = item.label.indexOf(' ');
      if (space > 0) {
        make = item.label.slice(0, space);
        model = item.label.slice(space + 1);
      }
    }
    // Last resort, and only for a one-word label: the manufacturer as written.
    // This is below the first-word split on purpose. Taking the manufacturer
    // first produced entries reading "BMW Group BMW i4", "BYD Auto BYD Atto 3",
    // "MG Motor MG 4 EV" — the corporate name glued in front of a label that
    // already carried the brand — and those strings do not just look wrong,
    // they are what the form would fill the make and model fields with.
    if (!make && item.makes.length) make = item.makes[0];
    if (!make) continue; // a one-word label with no maker names nothing
    if (!model) continue;

    // Only an unambiguous powertrain is reported. An item stating both a
    // gasoline engine and an electric motor is a hybrid-or-not question this
    // layer cannot answer, and a wrong `electric` here would auto-fill a petrol
    // car as electric on a platform that counts electric listings.
    const fuel = item.fuels.size === 1 ? [...item.fuels][0] : null;
    const keys = [...new Set([norm(item.label), norm(`${make} ${model}`)])];
    entries.push({
      make,
      model,
      label: item.label,
      fuel,
      kind: item.kind,
      keys,
      squashed: [...new Set(keys.map(squash))],
    });
  }
  return entries;
}

/**
 * Twenty-four hours. Wikidata changes on the timescale of Wikipedia edits, and
 * this is on the path of a picker that fires as somebody types: re-pulling
 * 13,000 models per keystroke is how a free public endpoint decides to stop
 * answering us. The pull costs ~8s, so it is also not something to repeat.
 */
const WIKI_TTL_MS = 24 * 60 * 60 * 1000;
let wikiCache: { at: number; value: WikiIndex } | null = null;
/**
 * The in-flight build, shared.
 *
 * Without this, the first three keystrokes on a cold instance each start their
 * own 8-second pull of the same 13,000 rows — the instance does the work three
 * times and Wikidata sees us as three times the traffic, at exactly the moment
 * we most want them to keep answering.
 */
let wikiBuilding: Promise<WikiIndex> | null = null;

async function buildWikiIndex(): Promise<WikiIndex> {
  const results = await Promise.allSettled(WIKIDATA_CLASSES.map((c) => fetchClass(c.qid)));
  const rows: { binding: Binding; kind: 'car' | 'tractor' }[] = [];
  const classes: string[] = [];
  let complete = true;
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') {
      if (WIKIDATA_CLASSES[i].required) complete = false;
      return;
    }
    classes.push(WIKIDATA_CLASSES[i].what);
    for (const binding of r.value) rows.push({ binding, kind: WIKIDATA_CLASSES[i].kind });
  });
  // Every class failing is a real failure — an empty index would answer "no
  // such car" to every question, which fails the check CLOSED and blocks real
  // listings. Better to throw and let the caller fail open.
  if (!classes.length) throw new Error('Wikidata answered nothing.');
  return { entries: buildEntries(rows), classes, complete };
}

async function wikidata(): Promise<{ value: WikiIndex; from: 'memory' | 'wikidata' }> {
  if (wikiCache && Date.now() - wikiCache.at < WIKI_TTL_MS) {
    return { value: wikiCache.value, from: 'memory' };
  }
  if (!wikiBuilding) {
    wikiBuilding = buildWikiIndex()
      .then((value) => {
        // An incomplete index is cached for a minute, not a day. It is worth
        // serving to a search right now; it is not worth being stuck with until
        // tomorrow because one query timed out once.
        wikiCache = { at: value.complete ? Date.now() : Date.now() - WIKI_TTL_MS + 60_000, value };
        return value;
      })
      .finally(() => {
        wikiBuilding = null;
      });
  }
  return { value: await wikiBuilding, from: 'wikidata' };
}

function toEntry(e: WikiEntry, fuel: string | null = e.fuel): CatalogueEntry {
  return {
    make: e.make,
    model: e.model,
    fuel,
    // Wikidata carries body styles, but not in AutoHire's `car_category` terms,
    // and mapping one onto the other would be guesswork dressed as data. The
    // form keeps its own category control for these; the fleet layer is where
    // categories come from.
    category: null,
    count: 0,
    source: 'wikidata',
  };
}

// ===========================================================================
// The three answers
// ===========================================================================

/**
 * Substring search over the world catalogue, best match first.
 *
 * Ranked, not filtered: a host typing "coro" wants Corolla above "Toyota
 * Corolla Verso Gen-2", and a plain `includes` sorted alphabetically buries the
 * common answer under its own variants.
 */
export function search(index: WikiIndex, query: string, limit: number): CatalogueEntry[] {
  const q = norm(query);
  const qs = squash(query);
  const hits: { entry: WikiEntry; rank: number }[] = [];
  for (const entry of index.entries) {
    let rank = 99;
    for (const k of entry.keys) {
      if (k === q) rank = Math.min(rank, 0);
      else if (k.startsWith(q)) rank = Math.min(rank, 1);
      else if (k.includes(q)) rank = Math.min(rank, 2);
    }
    if (rank === 99 && qs.length >= 3 && entry.squashed.some((s) => s.includes(qs))) rank = 3;
    if (rank !== 99) hits.push({ entry, rank });
  }
  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.entry.label.length - b.entry.label.length ||
      a.entry.label.localeCompare(b.entry.label),
  );
  return hits.slice(0, limit).map((h) => toEntry(h.entry));
}

/**
 * Is this a real car? Wikidata only — see the header.
 *
 * Matching is deliberately loose, in this order:
 *   exact  — the typed make+model is a catalogue name. Only this one carries
 *            the fuel back, because a loose match is a match on a DIFFERENT
 *            model: "Hyundai Ioniq 5" loosely matches "Hyundai Ioniq", which is
 *            a petrol car, and answering `petrol` for an Ioniq 5 would be worse
 *            than answering nothing.
 *   loose  — one name is the other plus more words: "Land Cruiser" against
 *            "Land Cruiser Prado", "Land Cruiser (J40)", or a host's "Corolla
 *            Altis" against "Corolla".
 *   squash — same letters and digits, different spacing: "MG4" against "MG 4
 *            EV". Real, and typed by real hosts.
 *
 * The second candidate covers hosts who repeat the make inside the model
 * ("MG" + "MG4"), which is common and would otherwise never match.
 *
 * Verified against all 44 make+model pairs in production: every real car
 * matches, including BMW i4, BYD Atto 3, BYD Seal, Nissan Patrol and MG4 — and
 * `Ferrari 2000 / Y` and `Lamborghini Model4`, the two fakes this check exists
 * for, match nothing.
 */
export function knownCar(
  index: WikiIndex,
  make: string,
  model: string,
): { known: boolean; matched: 'exact' | 'loose' | 'squash' | null; entry: CatalogueEntry | null } {
  const candidates = [norm(`${make} ${model}`)];
  if (norm(model).startsWith(norm(make))) candidates.push(norm(model));

  let loose: { matched: 'loose' | 'squash'; entry: WikiEntry } | null = null;
  for (const entry of index.entries) {
    if (entry.kind !== 'car') continue;
    for (const c of candidates) {
      for (const k of entry.keys) {
        if (k === c) return { known: true, matched: 'exact', entry: toEntry(entry) };
        if (!loose && (k.startsWith(`${c} `) || k.startsWith(`${c} (`) || c.startsWith(`${k} `))) {
          loose = { matched: 'loose', entry };
        }
      }
      const cs = squash(c);
      if (!loose && cs.length >= 3 && entry.squashed.some((s) => s.startsWith(cs))) {
        loose = { matched: 'squash', entry };
      }
    }
  }
  // A loose match says the car is real; it does not say which model it is, so
  // no fuel travels with it.
  return loose
    ? { known: true, matched: loose.matched, entry: toEntry(loose.entry, null) }
    : { known: false, matched: null, entry: null };
}

/**
 * Start building the Wikidata index without waiting for it.
 *
 * The fleet request is what the listing form makes on mount; the search and
 * check requests come a few seconds later, when the host has typed something.
 * On a cold instance that first search pays the whole pull — measured at 10–25s
 * against the live endpoint — and a host watching a spinner for twenty seconds
 * concludes the box is broken. Warming it on the request that always comes
 * first turns that wait into time the host spends filling in the form.
 *
 * `EdgeRuntime.waitUntil` where the platform provides it, so the work is not
 * cut off when the response returns; a plain floating promise elsewhere (and in
 * `deno run` locally). Errors are swallowed on purpose — this is a warm-up, and
 * the request that actually needs the index reports its own failure.
 */
function warmWikidata(): void {
  const p = wikidata().catch(() => undefined);
  (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
    ?.waitUntil?.(p);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  const known = url.searchParams.get('known');

  // ---- "is this a real car?" --------------------------------------------
  if (known === 'car') {
    const make = url.searchParams.get('make') ?? '';
    const model = url.searchParams.get('model') ?? '';
    if (!make.trim() || !model.trim()) {
      return json({ error: 'make and model are required.' }, 400);
    }
    try {
      const { value, from } = await wikidata();
      // Fail open on a partial index, exactly as on no index at all — see
      // `WikiIndex.complete`. Answering `false` here from half a catalogue is
      // how a host with a real Tesla gets told their car does not exist.
      if (!value.complete) {
        return json(
          { error: 'The vehicle index is incomplete.', code: 'index_unavailable' },
          502,
        );
      }
      return json({ ...knownCar(value, make, model), served_from: from }, 200, 3600);
    } catch (e) {
      // FAIL OPEN, and loudly enough that the client can tell. A 502 with no
      // answer is the correct shape here: `known: false` would mean "that car
      // does not exist" and would stop a host listing a perfectly real car
      // because Wikidata was down. The client turns this into 'unknown' and
      // lets the listing through.
      const message = e instanceof Error ? e.message : 'Could not reach the vehicle index.';
      return json({ error: message, code: 'index_unavailable' }, 502);
    }
  }

  // ---- world search ------------------------------------------------------
  if (q !== null) {
    const query = q.trim();
    // Two characters is where a prefix search stops being a search and starts
    // being "the first 20 rows of Wikidata, alphabetically".
    if (query.length < 2) return json({ entries: [], query }, 200, 3600);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 50);
    try {
      const { value, from } = await wikidata();
      return json(
        { entries: search(value, query, limit), query, classes: value.classes, served_from: from },
        200,
        3600,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not reach the vehicle index.';
      return json({ error: message, entries: [], query }, 502);
    }
  }

  // ---- the fleet ---------------------------------------------------------
  try {
    const { value, from } = await fleet();
    warmWikidata();
    return json({ ...value, served_from: from }, 200, 900);
  } catch (e) {
    // A stale copy beats no answer: the caller's fallback for "no answer" is a
    // picker with nothing in it, and a host halfway through listing a machine
    // would rather have last quarter-hour's catalogue than an empty box. Not
    // cached downstream, though — a stale body is served because it is better
    // than nothing right now, not because it is true.
    if (fleetCache) {
      return json({ ...fleetCache.value, served_from: 'memory', stale: true }, 200);
    }
    const message = e instanceof Error ? e.message : 'Could not read the listings catalogue.';
    return json({ error: message }, 502);
  }
});
