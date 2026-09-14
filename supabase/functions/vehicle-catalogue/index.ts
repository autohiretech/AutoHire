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
// THE TWO LAYERS, AND WHICH ONE WINS WHAT
//
//   1. AutoHire's own `listings` — authoritative for FUEL, CATEGORY and for
//      MACHINERY EXISTING AT ALL. It is the only source on earth that knows a
//      Grove GMK3060 is a crane, and the only one carrying real fuel/category.
//      It wins every conflict about what a vehicle IS.
//   2. The WORLD CATALOGUE — authoritative for WHETHER A CAR EXISTS, and the
//      breadth behind search. It is a UNION of three independent public
//      datasets, not one (see "WHY THREE SOURCES" below).
//
//   **The listings layer must never launder a fake car into layer 2's answer.**
//   `Ferrari 2000 / Y` is in `listings`; it is not a car; it must not become one
//   because a host typed it. So `knownCar()` below reads the world catalogue and
//   ONLY the world catalogue. That separation is the entire point of having two
//   layers and is enforced in one place, the `known=car` route, rather than by
//   anyone remembering it at a call site.
//
//   `carModels.ts` stays client-side as a seed for models nobody has listed
//   yet (see `web/src/lib/vehicleCatalogue.ts`).
//
// ---------------------------------------------------------------------------
// WHY THREE SOURCES, AND WHAT EACH ONE IS FOR
//
// This started as Wikidata alone, and Wikidata alone was REFUSING REAL CARS. A
// `known=car` answer of `false` blocks a host from listing a vehicle they own,
// so a gap in the one source is not a data-quality problem, it is a host who
// cannot trade. The gap is real and was measured against the live endpoints:
//
//   • Wikidata (bulk index, `wd:Q3231690` + friends) — 13,481 car models, 438
//     model series, 207 tractors. Global rather than American: Toyota Vitz,
//     Chery A1/QQ/Tiggo, Haval, all of which vPIC lacks. It is also the only
//     source here that carries a POWERTRAIN, which is the thing the picker
//     exists to auto-fill. **But it has no Koenigsegg at all**: a SPARQL query
//     for labels containing "koenigsegg" under `wdt:P31/wdt:P279* wd:Q3231690`
//     returns nothing, because Koenigsegg's cars are simply not classified that
//     way. Jesko, Regera, Agera — every one of them answered `known: false`.
//   • NHTSA vPIC (per-make, on demand) — US *registration* data, so it is a
//     different shape of wrong: `getmodelsformake/koenigsegg` returns Agera,
//     Regera, Jesko, CC850 and One:1. Measured against the other two, it is the
//     ONLY source for Tesla Semi and Cybercab, Toyota bZ Woodland and Echo,
//     every Scion-badged Toyota, Nissan Pickup and Altra-EV, and 98 of Ford's
//     149 — the E-150/E-350 vans and F-350 through F-750 that a rental platform
//     has every reason to carry. It is NOT a superset either: `getallmakes` has
//     no MG, no Chery, no Haval and no Great Wall, `getmodelsformake/chery`
//     returns 0, and its Toyota list has no Vitz.
//   • DBpedia (per-make prefix, on demand) — Wikipedia's infoboxes as SPARQL.
//     Earns its place on cars NEITHER of the other two has: Koenigsegg Gemera,
//     CCX, CC8S and CCR are absent from Wikidata's car classes AND from vPIC's
//     six-model Koenigsegg list, and DBpedia has all four. Same story for Ford
//     GT40 and GT90, Nissan Kubistar/Atleon/Trade and Honda FR-V. It also
//     independently covers Chery (40 models) and Toyota Vitz, so it is a second
//     answer where Wikidata was the only one.
//
// BOTH ON-DEMAND SOURCES OVER-INCLUDE, and that is accepted rather than
// filtered: vPIC files Honda's motorcycles under Honda (361 "models", most of
// them a Gold Wing or a PCX150), and DBpedia's `dbo:Automobile` sweeps in
// platforms and concepts ("Panther platform", "concept vehicles (2020–2029)").
// Both can therefore make `known=car` say yes to something that is not a car
// you can rent. That is the cheap failure — see OVER-INCLUSION below — and the
// expensive one is the Koenigsegg owner who cannot list their car at all.
//
// `carqueryapi` was tried and is NOT used: both `cmd=getMakes` and
// `cmd=getModels` answer with an empty body. There is nothing to adopt.
//
// THE UNION RULE: `known=car` is TRUE if ANY source knows the model. No single
// source's miss is evidence of anything — each of the three was caught missing
// a car the other two had. `false` is only returned when ALL THREE were
// reachable and none of them knew it.
//
// WHAT NONE OF THEM COVER: machinery beyond tractors. Excavators, cranes and
// forklifts are not modelled in Wikidata as instances of a model class — a
// count under the excavator class returns 0 — vPIC carries no machinery, and
// DBpedia's `dbo:Automobile` is cars by definition. So there is no dataset
// behind them and the UI rule is split accordingly: cars must be chosen from
// the catalogue, machinery is free text. Do not go hunting for a machinery
// class here; it was checked.
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
//   /vehicle-catalogue?q=corol&limit=20     { entries, query, sources } — world search
//   /vehicle-catalogue?known=car&make=&model=
//       { known, matched, matched_source, entry, sources }             — car check
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

/**
 * The three datasets behind the world catalogue.
 *
 * Named on the wire, not hidden, because the one question a human asks when
 * this function refuses a real car is "which source answered that?" — and with
 * three of them, guessing costs an afternoon. See `matched_source` on the
 * `known=car` reply and `sources` on both it and the search reply.
 */
export type WorldSource = 'wikidata' | 'vpic' | 'dbpedia';

export interface CatalogueEntry {
  make: string;
  model: string;
  fuel: string | null;
  category: string | null;
  /** How many listings back this entry. 0 for anything not from the fleet. */
  count: number;
  source: 'autohire' | WorldSource;
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
// LAYER 2, THE SHARED SHAPE — one entry type for all three sources
// ===========================================================================

/**
 * One model, as some source spells it, with everything the matcher needs
 * precomputed.
 *
 * Precomputed rather than derived at match time because `knownCar` runs over
 * ~14,000 of these on every check and the `norm`/`squash` calls are where the
 * time goes. This is the same reason `buildEntries` builds a vocabulary map
 * instead of scanning a list: on Supabase's runtime, a matcher that allocates
 * per comparison is not slow, it is CPU-killed, and the picker then gets no
 * answer at all.
 */
export interface WorldEntry {
  make: string;
  model: string;
  /** The source's own label, e.g. "Toyota Land Cruiser Prado (J150)". */
  label: string;
  fuel: string | null;
  kind: 'car' | 'tractor';
  source: WorldSource;
  /** Normalised forms this entry answers to — the label, and make+model. */
  keys: string[];
  /** The same keys with spacing and punctuation removed. */
  squashed: string[];
}

function worldEntry(
  make: string,
  model: string,
  label: string,
  source: WorldSource,
  kind: 'car' | 'tractor' = 'car',
  fuel: string | null = null,
): WorldEntry {
  const keys = [...new Set([norm(label), norm(`${make} ${model}`)])];
  return { make, model, label, fuel, kind, source, keys, squashed: [...new Set(keys.map(squash))] };
}

/**
 * Split a bare label into make + model against a hint the caller already has.
 *
 * vPIC hands back make and model as separate fields; DBpedia hands back only
 * "Koenigsegg Jesko", and the only thing that can tell us where the make ends
 * is the prefix we searched for. The hint is used only when it really is a
 * prefix — for a one-word query like "koenigsegg" the label "Koenigsegg Jesko"
 * splits on the hint, and for a two-word query like "koenigsegg jesko" the hint
 * swallows the whole label, so it falls through to the first-space split and
 * still yields make "Koenigsegg", model "Jesko". Getting this wrong does not
 * produce a missing row, it produces a row whose make and model are what the
 * FORM FILLS IN, which is worse than not offering it.
 */
function splitLabel(label: string, makeHint: string | null): { make: string; model: string } | null {
  // Split on WORD COUNT, not on the hint's character length. The hint is a
  // normalised query ("land rover") and the label is whatever the source wrote
  // ("Land  Rover Defender", with two spaces, which really happens) — slicing
  // the label at `hint.length` characters would then cut a letter off the model
  // and put it on the end of the make, and both strings are what the form fills
  // the host's fields with.
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  let take = 1;
  if (makeHint) {
    const hint = norm(makeHint).split(' ').filter(Boolean);
    // `hint.length < words.length`, so a hint that swallows the whole label
    // ("koenigsegg jesko" against "Koenigsegg Jesko") leaves no model and falls
    // back to the first-word split, which is the right answer for it anyway.
    if (hint.length && hint.length < words.length && norm(words.slice(0, hint.length).join(' ')) === hint.join(' ')) {
      take = hint.length;
    }
  }
  const make = words.slice(0, take).join(' ');
  const model = words.slice(take).join(' ');
  return make && model ? { make, model } : null;
}

/**
 * How a check went, per source. Only `hit` and `miss` are ANSWERS.
 *
 * `partial`, `error` and `skipped` all mean "this source did not get to have an
 * opinion", and the difference between them is only for the human reading the
 * reply: `partial` is a Wikidata index that built without its required class,
 * `error` is an endpoint that was down, slow or rate-limiting, and `skipped` is
 * a source we never asked because an earlier one had already said yes. None of
 * them may ever be counted as a "no" — see `authoritative()`.
 *
 * `skipped` is written down rather than quietly reported as `miss` because a
 * reply saying "vPIC: miss" when vPIC was never called is a reply that sends
 * the next person debugging this to the wrong endpoint.
 */
type SourceStatus = 'hit' | 'miss' | 'partial' | 'error' | 'skipped';

/**
 * May a `false` be returned?
 *
 * ONLY when every source actually answered. A `false` here blocks a host from
 * listing a car they own, so the bar is not "we asked" but "all three replied".
 * One endpoint being slow must never turn into "your car does not exist".
 */
export function authoritative(sources: Record<WorldSource, SourceStatus>): boolean {
  return Object.values(sources).every((s) => s === 'hit' || s === 'miss');
}

// ===========================================================================
// LAYER 2, SOURCE 1 — Wikidata (bulk index)
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

interface WikiIndex {
  entries: WorldEntry[];
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
export function buildEntries(rows: { binding: Binding; kind: 'car' | 'tractor' }[]): WorldEntry[] {
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

  const entries: WorldEntry[] = [];
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
    entries.push(worldEntry(make, model, item.label, 'wikidata', item.kind, fuel));
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

function toEntry(e: WorldEntry, fuel: string | null = e.fuel): CatalogueEntry {
  return {
    make: e.make,
    model: e.model,
    fuel,
    // Wikidata carries body styles, but not in AutoHire's `car_category` terms,
    // and mapping one onto the other would be guesswork dressed as data. vPIC
    // and DBpedia do not carry a usable category either. The form keeps its own
    // category control for these; the fleet layer is where categories come from.
    category: null,
    count: 0,
    source: e.source,
  };
}

// ===========================================================================
// A CACHE FOR THE ON-DEMAND SOURCES
// ===========================================================================

/**
 * A keyed, TTL'd, de-duplicated, BOUNDED cache in front of one remote lookup.
 *
 * Every property in that sentence is paid for by a real failure:
 *
 *   • TTL'd, because both routes fire as the host types — the search box
 *     debounces at 250ms and `known=car` is re-asked for every make+model the
 *     form settles on. Without a cache, a host typing "Corolla" costs vPIC and
 *     DBpedia one request per window, for the SAME make every time. Free public
 *     endpoints answer that pattern by not answering.
 *   • De-duplicated in flight, the same reason `wikiBuilding` exists above: the
 *     first three keystrokes on a cold instance otherwise each start their own
 *     copy of the identical request, so we do the work three times AND look
 *     like three times the traffic at the moment we most want to look like one.
 *   • BOUNDED, because this is keyed by something a host types. An unbounded
 *     map keyed by user input is an unbounded map: a warm instance that has
 *     seen a few thousand distinct makes grows until the runtime kills it, and
 *     the symptom is the picker silently losing its index, not an error.
 *     Insertion-ordered eviction (Map iteration order) is enough — this is a
 *     politeness cache, not a hit-rate optimisation.
 *   • NEGATIVE RESULTS ARE CACHED, errors are NOT. "vPIC has no models for
 *     Chery" is an answer and re-asking it every keystroke is the same abuse as
 *     re-asking a hit. An error is not an answer, and caching it would turn one
 *     slow minute at Wikimedia into a day of us refusing to look again.
 */
function cached<T>(
  ttlMs: number,
  max: number,
  load: (key: string) => Promise<T>,
): (key: string) => Promise<T> {
  const store = new Map<string, { at: number; value: T }>();
  const inflight = new Map<string, Promise<T>>();
  return (key: string) => {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
    const running = inflight.get(key);
    if (running) return running;
    const p = load(key)
      .then((value) => {
        store.set(key, { at: Date.now(), value });
        while (store.size > max) {
          const oldest = store.keys().next();
          if (oldest.done) break;
          store.delete(oldest.value);
        }
        return value;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, p);
    return p;
  };
}

// ===========================================================================
// LAYER 2, SOURCE 2 — NHTSA vPIC (per make, on demand)
// ===========================================================================

const VPIC_ENDPOINT = 'https://vpic.nhtsa.dot.gov/api/vehicles';

/**
 * PER-MAKE ON DEMAND, NOT BULK. This was a deliberate choice, so here is the
 * arithmetic that made it.
 *
 * vPIC's `getallmakes` returns 12,362 makes and there is no endpoint that
 * returns every model for every make — the only way to a bulk index is 12,362
 * calls to `getmodelsformake/{make}`, which is not a cold start, it is a denial
 * of service we would be committing against a government API once per instance.
 * And it would buy nothing: the `known=car` check ALREADY KNOWS THE MAKE, so
 * one targeted request answers exactly the question asked, in well under a
 * second, cached for a day.
 *
 * `getallmakes` is not fetched either, for the same reason it would have been:
 * the only thing it could tell us is whether vPIC has heard of a make, and
 * under the union rule that changes nothing — a make vPIC has never heard of
 * (Chery, MG, Haval, Great Wall are all absent from it) is not evidence the car
 * is fake, it is just vPIC having nothing to say. 600KB per instance to learn
 * something we would then ignore.
 *
 * `getmodelsformakeyear` is not used: the listing form asks for a make and a
 * model, not a year, and narrowing by a year we do not have could only ever
 * turn a real car into a refusal.
 */
const VPIC_TTL_MS = 24 * 60 * 60 * 1000;
/** 500 small model lists is far more than one instance will see in a day. */
const VPIC_MAX_MAKES = 500;

type VpicRow = { Make_Name?: string; Model_Name?: string };

/**
 * `getmodelsformake` SUBSTRING-MATCHES THE MAKE, and that is a trap.
 *
 * `getmodelsformake/mg` does not return MGs. It returns "Jim-Glo Trailers",
 * "MGS Incorparated" and "MGM Trailers" — every registered manufacturer whose
 * name happens to contain the letters. Left unfiltered that is a false-positive
 * machine: a host types a two-letter make and vPIC "confirms" their car against
 * a trailer company. So rows are kept only when `Make_Name` IS the make that
 * was asked for. A row that survives that filter is a row whose own make and
 * model are what the match is made against.
 */
async function loadVpic(make: string): Promise<WorldEntry[]> {
  const res = await fetch(
    `${VPIC_ENDPOINT}/getmodelsformake/${encodeURIComponent(make)}?format=json`,
    {
      headers: { Accept: 'application/json' },
      // This is on a keystroke path. vPIC normally answers in well under a
      // second; anything past ten is a source having a bad day, and the right
      // move is to let the union answer without it rather than hold the host's
      // form open. The timeout surfaces as `error`, which fails OPEN.
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) throw new Error(`vPIC answered ${res.status} for ${make}`);
  const body = (await res.json()) as { Results?: VpicRow[] };
  const wanted = norm(make);
  const entries: WorldEntry[] = [];
  const seen = new Set<string>();
  for (const row of body.Results ?? []) {
    const rowMake = (row.Make_Name ?? '').trim();
    const rowModel = (row.Model_Name ?? '').trim();
    if (!rowMake || !rowModel) continue;
    if (norm(rowMake) !== wanted) continue; // the substring trap, above
    const k = norm(`${rowMake} ${rowModel}`);
    if (seen.has(k)) continue;
    seen.add(k);
    // No fuel: vPIC's model lists carry none, and inventing one would auto-fill
    // the field this catalogue exists to get right.
    entries.push(worldEntry(rowMake, rowModel, `${rowMake} ${rowModel}`, 'vpic'));
  }
  return entries;
}

/**
 * Exported, like `aggregate`, `buildEntries`, `search` and `knownCar`, so the
 * part that can be *wrong* rather than merely broken can be run against the
 * live endpoint without deploying. Whether vPIC actually has a Jesko, and what
 * its rows look like when it does not, is not a thing to reason about.
 */
export const vpicModels = cached(VPIC_TTL_MS, VPIC_MAX_MAKES, loadVpic);

// ===========================================================================
// LAYER 2, SOURCE 3 — DBpedia (per make prefix, on demand)
// ===========================================================================

const DBPEDIA_ENDPOINT = 'https://dbpedia.org/sparql';
const DBPEDIA_TTL_MS = 24 * 60 * 60 * 1000;
const DBPEDIA_MAX_PREFIXES = 500;

/**
 * The most this will pull for one make.
 *
 * "toyota" alone is a few hundred labels. The cap is there so a one-letter
 * prefix that slipped through the guards cannot drag the whole `dbo:Automobile`
 * class through a keystroke-path request.
 */
const DBPEDIA_LIMIT = 500;

/**
 * Escape a host-typed string for a SPARQL string literal.
 *
 * This is the one place in this function where user input is CONCATENATED INTO
 * A QUERY LANGUAGE. A make containing a double quote ends the literal, and what
 * follows is parsed as SPARQL — at best a 400 that makes DBpedia look broken,
 * at worst somebody else's query running under our User-Agent. Backslash first,
 * or the escaping escapes its own escapes.
 */
function sparqlString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Every `dbo:Automobile` whose English label starts with this prefix.
 *
 * A prefix query rather than a CONTAINS: measured against the live endpoint,
 * `STRSTARTS` over `dbo:Automobile` answers in ~2s for "chery" and "koenigsegg"
 * while the equivalent CONTAINS on Wikidata TIMES OUT at 60s. Two seconds is
 * affordable once per make per day; a minute is not affordable at all.
 *
 * `dbo:Automobile` is the class, and it is cars only — no machinery. That is
 * the same boundary the other two sources have and the same one the UI draws.
 */
async function loadDbpedia(prefix: string): Promise<WorldEntry[]> {
  const query = `SELECT DISTINCT ?label WHERE {
  ?car a dbo:Automobile ; rdfs:label ?label .
  FILTER(langMatches(lang(?label), "en"))
  FILTER(STRSTARTS(LCASE(?label), "${sparqlString(prefix.toLowerCase())}"))
} LIMIT ${DBPEDIA_LIMIT}`;
  const url = `${DBPEDIA_ENDPOINT}?query=${encodeURIComponent(query)}&format=${encodeURIComponent(
    'application/sparql-results+json',
  )}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': WIKIDATA_UA },
    // Same reasoning as vPIC's ten, with more room: DBpedia's Virtuoso answers
    // a prefix query in ~2s but is a shared public endpoint and occasionally
    // queues. Fifteen seconds still fails OPEN rather than late.
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`DBpedia answered ${res.status} for "${prefix}"`);
  const body = (await res.json()) as { results?: { bindings?: Binding[] } };
  const entries: WorldEntry[] = [];
  const seen = new Set<string>();
  for (const binding of body.results?.bindings ?? []) {
    const label = binding.label?.value?.trim();
    if (!label) continue;
    const split = splitLabel(label, prefix);
    if (!split) continue;
    // "MG (automobile)" is Wikipedia disambiguating the MARQUE, not naming a
    // model, and it arrives here as make "MG", model "(automobile)". Left in,
    // the picker offers a row reading "MG (automobile)" and the form fills the
    // model field with a parenthesis. A model that is only a bracketed
    // qualifier names nothing.
    if (split.model.startsWith('(')) continue;
    const k = norm(label);
    if (seen.has(k)) continue;
    seen.add(k);
    // No fuel, and none is asked for: a `dbo:fuelType` query over the Toyota
    // labels returns zero rows, so there is nothing here to map onto AutoHire's
    // four fuel values. Wikidata stays the only source that answers "is this
    // one electric?", which is fine — it is the source with the coverage on the
    // ordinary cars whose fuel anybody wants auto-filled.
    entries.push(worldEntry(split.make, split.model, label, 'dbpedia'));
  }
  return entries;
}

/** Exported for the same reason as `vpicModels` — see above. */
export const dbpediaModels = cached(DBPEDIA_TTL_MS, DBPEDIA_MAX_PREFIXES, loadDbpedia);

// ===========================================================================
// The three answers
// ===========================================================================

/**
 * Substring search over a pile of entries from any mix of sources, best match
 * first. Ranks are exposed rather than sliced away because the caller decides
 * whether the best rank is good enough to skip widening the search — see the
 * `?q=` route.
 *
 * Ranked, not filtered: a host typing "coro" wants Corolla above "Toyota
 * Corolla Verso Gen-2", and a plain `includes` sorted alphabetically buries the
 * common answer under its own variants.
 */
export function rank(entries: WorldEntry[], query: string): { entry: WorldEntry; rank: number }[] {
  const q = norm(query);
  const qs = squash(query);
  // De-duplicated across sources, because three datasets describing the same
  // world means "Toyota Corolla" arrives three times. A picker that offers the
  // same car three rows running looks broken, and it pushes the row the host
  // actually wants off the bottom of a ten-row list.
  //
  // On a tie the WIKIDATA copy wins, and that is not arbitrary: it is the only
  // one of the three carrying a powertrain, so keeping it is the difference
  // between the form auto-filling `electric` for an Ioniq 5 and leaving it on
  // its `petrol` default.
  const best = new Map<string, { entry: WorldEntry; rank: number }>();
  for (const entry of entries) {
    let r = 99;
    for (const k of entry.keys) {
      if (k === q) r = Math.min(r, 0);
      else if (k.startsWith(q)) r = Math.min(r, 1);
      else if (k.includes(q)) r = Math.min(r, 2);
    }
    if (r === 99 && qs.length >= 3 && entry.squashed.some((s) => s.includes(qs))) r = 3;
    if (r === 99) continue;
    const id = `${norm(entry.make)} ${norm(entry.model)}`;
    const held = best.get(id);
    if (
      !held ||
      r < held.rank ||
      (r === held.rank && entry.source === 'wikidata' && held.entry.source !== 'wikidata')
    ) {
      best.set(id, { entry, rank: r });
    }
  }
  const hits = [...best.values()];
  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.entry.label.length - b.entry.label.length ||
      a.entry.label.localeCompare(b.entry.label),
  );
  return hits;
}

export function search(entries: WorldEntry[], query: string, limit: number): CatalogueEntry[] {
  return rank(entries, query)
    .slice(0, limit)
    .map((h) => toEntry(h.entry));
}

export type MatchKind = 'exact' | 'loose' | 'squash';

export interface KnownCarAnswer {
  known: boolean;
  matched: MatchKind | null;
  /**
   * WHICH DATASET SAID YES. The whole point of running three.
   *
   * When a host reports "it says my car isn't real", the first question is
   * which source was asked and what each one said — the `sources` map on the
   * reply carries that for every check, and this carries it for the one that
   * answered. Without it, a wrong answer from a three-source union is an
   * afternoon of guessing which third of it was wrong.
   */
  matched_source: WorldSource | null;
  entry: CatalogueEntry | null;
}

/**
 * Is this a real car, ACCORDING TO ONE SOURCE'S ENTRIES?
 *
 * One source, on purpose: this is the matcher, not the policy. The policy —
 * which sources get asked, in what order, and when a miss is allowed to become
 * a `false` — lives in `knownCarUnion` below, in one place, because it is the
 * part that can block a host from listing their car.
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
export function knownCar(entries: WorldEntry[], make: string, model: string): KnownCarAnswer {
  const candidates = [norm(`${make} ${model}`)];
  if (norm(model).startsWith(norm(make))) candidates.push(norm(model));

  let loose: { matched: 'loose' | 'squash'; entry: WorldEntry } | null = null;
  for (const entry of entries) {
    if (entry.kind !== 'car') continue;
    for (const c of candidates) {
      for (const k of entry.keys) {
        if (k === c) {
          return { known: true, matched: 'exact', matched_source: entry.source, entry: toEntry(entry) };
        }
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
    ? {
        known: true,
        matched: loose.matched,
        matched_source: loose.entry.source,
        entry: toEntry(loose.entry, null),
      }
    : { known: false, matched: null, matched_source: null, entry: null };
}

/**
 * The union, in the order that costs the least.
 *
 * WIKIDATA IS ASKED FIRST AND ALONE, and only its miss buys a network call.
 * That is the whole shape of this function and it is deliberate:
 *
 *   • The Wikidata index is already in memory on a warm instance, so the
 *     overwhelming majority of checks — Corolla, Model 3, Patrol, RAV4, every
 *     car this platform actually rents — are answered with zero requests to
 *     anybody. Firing all three sources in parallel on every keystroke-driven
 *     check would be faster in the worst case and would multiply our traffic
 *     to two free public endpoints by the number of checks that never needed
 *     them, which is most of them.
 *   • The misses are exactly the bug. Koenigsegg is a Wikidata miss, and a
 *     Wikidata miss is the only case where the extra ~2s of vPIC + DBpedia is
 *     buying anything at all.
 *
 * vPIC and DBpedia then run TOGETHER, not in sequence: they are independent and
 * the host is waiting, so the cost is the slower of the two rather than the sum.
 * `allSettled`, so one of them being down still lets the other answer — a
 * rejection becomes `error`, which can never produce a `false`.
 *
 * A Wikidata build FAILURE is not fatal here either, which it used to be: it
 * marks `wikidata: 'error'` and the other two still get to say yes. Before,
 * Wikidata being slow meant every host got a 502 and no check at all.
 */
export async function knownCarUnion(
  make: string,
  model: string,
): Promise<{ answer: KnownCarAnswer; sources: Record<WorldSource, SourceStatus>; served_from: string }> {
  const sources: Record<WorldSource, SourceStatus> = {
    wikidata: 'error',
    vpic: 'error',
    dbpedia: 'error',
  };
  let served_from = 'wikidata';

  try {
    const { value, from } = await wikidata();
    served_from = from;
    const hit = knownCar(value.entries, make, model);
    if (hit.known) {
      // A hit is a hit whether or not the index was complete — a partial index
      // can only ever under-report, never invent a car.
      sources.wikidata = 'hit';
      sources.vpic = 'skipped';
      sources.dbpedia = 'skipped';
      return { answer: hit, sources, served_from };
    }
    // `partial` rather than `miss`: an index that built without its required
    // class did not answer the question, it failed to look. Counting that as a
    // "no" is how a host with a real Tesla gets told their car does not exist.
    sources.wikidata = value.complete ? 'miss' : 'partial';
  } catch {
    sources.wikidata = 'error';
  }

  // Wikidata could not place it. Now, and only now, ask the other two.
  const [vpic, dbpedia] = await Promise.allSettled([
    vpicModels(make.trim()),
    // The MAKE is the prefix, not make+model: DBpedia labels read "Koenigsegg
    // Jesko", so a prefix of the make returns the whole marque and the matcher
    // below picks the model out of it — including the loose and squashed forms
    // ("MG" + "MG4" against "MG 4 EV") that an exact prefix would never reach.
    dbpediaModels(make.trim().toLowerCase()),
  ]);

  const settled = [
    ['vpic', vpic],
    ['dbpedia', dbpedia],
  ] as const;
  // Reachability is recorded for BOTH before either is searched. Both were
  // awaited, so both have a real status, and returning early on a vPIC hit must
  // not leave DBpedia reported as `error` when it answered perfectly well.
  for (const [name, result] of settled) {
    sources[name] = result.status === 'fulfilled' ? 'miss' : 'error';
  }
  for (const [name, result] of settled) {
    if (result.status !== 'fulfilled') continue;
    const hit = knownCar(result.value, make, model);
    if (hit.known) {
      sources[name] = 'hit';
      return { answer: hit, sources, served_from };
    }
  }

  return {
    answer: { known: false, matched: null, matched_source: null, entry: null },
    sources,
    served_from,
  };
}

/**
 * The makes worth asking the on-demand sources about, for a free-text search.
 *
 * `?q=` has no make field — it is one box the host is typing into — so the make
 * has to be guessed out of the query, and the guess is simply its leading
 * words. Two candidates at most: the first word, and the first two words. The
 * second is not padding: "Land Rover", "Alfa Romeo", "Great Wall" and "Mercedes
 * Benz" are all two-word makes, and a one-word guess turns every one of them
 * into a search for cars made by "Land".
 *
 * Anything past two words is dropped. A three-word prefix is a model name, not
 * a make, and each extra candidate is another pair of requests to endpoints we
 * are trying not to hammer.
 */
function makeCandidates(query: string): string[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const out = [words[0]];
  if (words.length >= 2) out.push(`${words[0]} ${words[1]}`);
  return out;
}

/**
 * Widen a search that Wikidata came up short on.
 *
 * NOT run on every search — see the caller. Searching is the keystroke path in
 * its purest form: a host typing "toyota corolla" produces a request per
 * debounce window, and Wikidata answers every one of them from memory. Reaching
 * out to two more endpoints for a query that is already answered would buy
 * nothing and cost us the endpoints.
 */
async function widenSearch(
  query: string,
): Promise<{ entries: WorldEntry[]; vpic: SourceStatus; dbpedia: SourceStatus }> {
  const makes = makeCandidates(query);
  const jobs: { source: 'vpic' | 'dbpedia'; run: Promise<WorldEntry[]> }[] = [];
  for (const make of makes) {
    jobs.push({ source: 'vpic', run: vpicModels(make) });
    jobs.push({ source: 'dbpedia', run: dbpediaModels(make) });
  }
  const results = await Promise.allSettled(jobs.map((j) => j.run));
  const entries: WorldEntry[] = [];
  const status: Record<'vpic' | 'dbpedia', SourceStatus> = { vpic: 'error', dbpedia: 'error' };
  results.forEach((r, i) => {
    const { source } = jobs[i];
    if (r.status !== 'fulfilled') return;
    // One candidate succeeding is enough to call the source reachable; the
    // other may legitimately be a two-word make that does not exist.
    status[source] = 'miss';
    entries.push(...r.value);
  });
  return { entries, vpic: status.vpic, dbpedia: status.dbpedia };
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
      const { answer, sources, served_from } = await knownCarUnion(make, model);
      if (answer.known) return json({ ...answer, sources, served_from }, 200, 3600);

      // NOBODY KNEW IT. That is only an answer if everybody was asked and
      // everybody replied — `authoritative()` is the whole fail-open rule in
      // one place. A `false` stops a host listing a car they own, so a source
      // that timed out, rate-limited us, or built a partial index does not get
      // to vote no by being absent.
      if (!authoritative(sources)) {
        return json(
          {
            error: 'The vehicle index is incomplete.',
            code: 'index_unavailable',
            // The statuses travel with the 502 on purpose: "incomplete" without
            // saying which of three sources was incomplete is a bug report
            // nobody can act on.
            sources,
          },
          502,
        );
      }
      return json({ ...answer, sources, served_from }, 200, 3600);
    } catch (e) {
      // FAIL OPEN, and loudly enough that the client can tell. A 502 with no
      // answer is the correct shape here: `known: false` would mean "that car
      // does not exist" and would stop a host listing a perfectly real car
      // because a public dataset was down. The client turns this into 'unknown'
      // and lets the listing through.
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
    let index: WikiIndex | null = null;
    let served_from = 'wikidata';
    try {
      const got = await wikidata();
      index = got.value;
      served_from = got.from;
    } catch {
      // Not fatal any more. Wikidata being down used to empty the picker's
      // world list outright; now the on-demand sources below can still answer a
      // search for a make, which is what the host is usually typing.
      index = null;
    }

    const sources: Record<WorldSource, SourceStatus> = {
      // `partial` is reported here rather than folded into `miss` because a
      // half-built index is the difference between "Wikidata has no Teslas" and
      // "Wikidata's 13,481-model class timed out again" — and search is where
      // that shows up first, as a picker that has quietly gone thin.
      wikidata: index ? (index.complete ? 'miss' : 'partial') : 'error',
      vpic: 'skipped',
      dbpedia: 'skipped',
    };
    let entries: WorldEntry[] = index?.entries ?? [];
    let hits = index ? rank(entries, query) : [];

    // WIDEN ONLY WHEN WIKIDATA CAME UP SHORT, and "short" means it produced no
    // hit that starts with what was typed (rank 0 or 1). Rank 2 and 3 are a
    // substring and a de-spaced substring — real matches, but the kind that
    // "toyota crown signia" gets from "Toyota Crown" while the car the host
    // actually owns is nowhere in the list.
    //
    // Two things ride on this condition, and both were measured against the
    // live sources. It keeps the ordinary search off vPIC and DBpedia entirely:
    // the listing form sends "<make> <model>", so "chery qq" and "land rover
    // defender" rank at 0 or 1 in Wikidata and reach nobody else. And it is
    // what makes "koenigsegg" work, because Wikidata returns literally nothing
    // for it. (A bare model with no make — "corolla" on its own — ranks 2
    // against the key "toyota corolla" and does widen. That is one cached pair
    // of requests per first word, and it is the case where the host has given
    // us the least to go on.)
    //
    // A PARTIAL OR MISSING INDEX ALWAYS WIDENS, whatever it managed to rank.
    // Seen live while building this: the 13,481-model `car model` class timed
    // out, the index came back holding only model series and tractors, and
    // "tesla" still produced a rank-1 hit off a series row — good enough to
    // suppress widening and leave the host looking at one odd suggestion where
    // there should have been eight. Half an index is exactly when the other two
    // sources are worth the request.
    const best = hits[0]?.rank ?? 99;
    if ((best > 1 || !index?.complete) && query.length >= 3) {
      const widened = await widenSearch(query);
      sources.vpic = widened.vpic;
      sources.dbpedia = widened.dbpedia;
      if (widened.entries.length) {
        // Re-ranked over the UNION rather than appended: a Koenigsegg Jesko
        // from DBpedia has to be able to outrank a rank-2 Wikidata substring
        // match, and it only can if both go through the same sort.
        entries = entries.concat(widened.entries);
        hits = rank(entries, query);
      }
    }
    const shown = hits.slice(0, limit);
    // `hit` here means "this source put a row on the page", which is the thing
    // worth knowing when somebody asks why a search looks the way it does.
    for (const h of shown) sources[h.entry.source] = 'hit';

    // Nothing to show and no index to have shown it from. Search fails the same
    // way it always did — an error the client turns into an empty list — rather
    // than a 200 that claims the world catalogue has no Corollas in it.
    if (!shown.length && !index) {
      return json(
        { error: 'Could not reach the vehicle index.', entries: [], query, sources },
        502,
      );
    }
    return json(
      {
        entries: shown.map((h) => toEntry(h.entry)),
        query,
        classes: index?.classes ?? [],
        sources,
        served_from,
      },
      200,
      3600,
    );
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
