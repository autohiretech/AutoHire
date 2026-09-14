import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronRight, ImagePlus, Search, X, Zap } from 'lucide-react';
import type { CarCategory, FuelType, Transmission } from '@autohire/shared';
import { client } from '@/lib/client';
import type { CreateListingInput } from '@/lib/types';
import { Button, Card, CardBody, CardHeader, Chip, Input, Label, Notice, Select, Skeleton, toast } from '@/components/ui';
import { Img } from '@/components/Img';
import {
  useVehicleCatalogue,
  useVehicleSearch,
  useIsKnownCarModel,
  lookupVehicle,
  type CatalogueEntry,
} from '@/lib/vehicleCatalogue';
import { CurrencyCombobox } from '@/components/CurrencyCombobox';
import { LocationPicker, type LatLng } from '@/components/map/LocationPicker';
import { extractLatLngFromMapsUrl, isGoogleMapsLink, isLikelyUrl, isShortMapsLink, normalizeUrl } from '@/lib/location';
import { useCountry } from '@/lib/country';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { citiesFor } from '@/lib/cities';
import { CAR_CATEGORIES, CATEGORY_GROUPS, isMachine } from '@/lib/categories';

const FUELS: { value: FuelType; label: string }[] = [
  { value: 'petrol', label: 'Petrol' },
  { value: 'diesel', label: 'Diesel' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'electric', label: 'Electric' },
];

const FUEL_LABEL = Object.fromEntries(FUELS.map((f) => [f.value, f.label])) as Record<
  FuelType,
  string
>;

const CATEGORY_LABEL = Object.fromEntries(
  CAR_CATEGORIES.map((c) => [c.value, c.label]),
) as Record<CarCategory, string>;

/** One row of a make/model dropdown. `model` is absent on a make-only row. */
interface Suggestion {
  key: string;
  make: string;
  model?: string;
  fuel: FuelType | null;
  category: CarCategory | null;
  /** How many listings the catalogue has behind this entry. Ranks the list. */
  count: number;
  /** From the world catalogue rather than from AutoHire's own fleet. */
  world?: boolean;
}

/** Punctuation and spacing are noise here: "Model 3", "model-3" and "model3"
 *  are the same car, and a host typing any of them means the same one. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** How well a candidate answers a query. Lower is better, `null` is no match. */
function rank(hay: string, q: string): number | null {
  const h = hay.toLowerCase();
  if (h === q) return 0;
  if (h.startsWith(q)) return 1;
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(h)) return 2;
  if (h.includes(q)) return 3;
  if (squash(hay).includes(squash(q))) return 4;
  return null;
}

/**
 * Rank and cut a dropdown's rows for a typed query.
 *
 * Capped at 10 because this list is read, not scrolled: a catalogue of
 * thousands of models rendered in full is a scroll container nobody reaches
 * the bottom of, and on a phone it is a wall over the rest of the form.
 * With nothing typed the cap becomes "the ten most-listed", which is a useful
 * answer to "what do people list?" rather than an alphabetical accident.
 */
function pickSuggestions(
  rows: Suggestion[],
  query: string,
  fields: (s: Suggestion) => string[],
  limit = 10,
): Suggestion[] {
  const q = query.trim().toLowerCase();
  const byCount = (a: Suggestion, b: Suggestion) =>
    b.count - a.count || a.make.localeCompare(b.make) || (a.model ?? '').localeCompare(b.model ?? '');
  if (!q) return [...rows].sort(byCount).slice(0, limit);
  const scored: { s: Suggestion; r: number }[] = [];
  for (const s of rows) {
    let best: number | null = null;
    for (const f of fields(s)) {
      const r = rank(f, q);
      if (r !== null && (best === null || r < best)) best = r;
    }
    if (best !== null) scored.push({ s, r: best });
  }
  scored.sort((a, b) => a.r - b.r || byCount(a.s, b.s));
  return scored.slice(0, limit).map((x) => x.s);
}

/** The danger border a field wears once it has been asked for and left empty. */
const invalidField = 'border-[var(--color-danger-500)] focus:border-[var(--color-danger-500)]';

/**
 * "Required", on the label, from the moment the form loads.
 *
 * A host should learn a field is mandatory while looking at it, not after
 * pressing Continue and reading a list. It turns red only once they have
 * actually been stopped by it.
 */
function Req({ missing }: { missing: boolean }) {
  return (
    <span
      className={cn(
        'ml-1.5 align-middle text-caption font-medium',
        missing ? 'text-[var(--color-danger-500)]' : 'text-[var(--color-content-subtle)]',
      )}
    >
      Required
    </span>
  );
}

/** Split a textarea of comma/newline-separated values into a trimmed list. */
function toList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Create a new listing. Reached at /cars/new (linked from the host dashboard).
 * Photos are pasted as image URLs for now — Supabase Storage uploads are a
 * separate step. The first listing promotes the account to an individual host.
 */
/** The stages, in order. Index + 1 is the step number used throughout. */
const STEPS = ['Vehicle', 'Location', 'Pricing', 'Availability', 'Photos', 'Review'];

/**
 * One sentence per stage, saying what is being asked for and why.
 *
 * The old page had none of this: it showed every field at once and left the
 * host to infer the purpose of each from its label. A stage can afford a
 * sentence, and the sentence is most of what makes the form feel easy.
 */
const STEP_BLURB = [
  'What are you renting out? This is what renters search for, so the plainer the better.',
  'Where does a renter collect it? Drop the pin exactly where you hand over the keys — a listing with no pin never appears on the map.',
  'What does it cost, and how do renters pay you? You can take online payments, cash at pickup, or both.',
  'Is it available now? Say so if it is off the road, and when it comes back.',
  'Photos do most of the renting. The first one is the cover.',
  'A last look before it goes live. Anything here can still be changed afterwards.',
];

/** One line of the review summary. */
function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    // Label over value on a phone, label-and-value across on anything wider.
    // Squeezed onto one line at 320px the value had ~150px and a listing title
    // was cut mid-word — a review row that hides what it is reviewing. Given
    // the full width it wraps to two lines instead, and only then clips.
    <div className="flex flex-col gap-0.5 border-b border-[var(--color-line)] pb-2 last:border-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-[var(--color-content-muted)]">{label}</dt>
      <dd className="line-clamp-2 min-w-0 font-medium text-[var(--color-content)] sm:w-auto sm:truncate sm:text-right">
        {value}
      </dd>
    </div>
  );
}

export function ListCarPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id: editId } = useParams();
  const editing = !!editId;

  // A car is registered in the host's account country — set on the Account
  // page, not chosen per-listing. That's the one thing that stops a host's
  // fleet from spreading across markets they don't actually operate in.
  const { countries, currencies } = useCountry();
  const { data: me } = useCurrentUser();
  const accountCountry = me?.country;

  // In edit mode, load the existing listing to prefill the form.
  const existingQuery = useQuery({
    queryKey: ['listing', editId],
    queryFn: () => client.getListing(editId!),
    enabled: editing,
  });

  const [title, setTitle] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('2020');
  const [category, setCategory] = useState<CarCategory>('suv');
  const [seats, setSeats] = useState('5');
  const [transmission, setTransmission] = useState<Transmission>('automatic');
  const [fuel, setFuel] = useState<FuelType>('petrol');
  // Whether the host has set fuel/category themselves. The catalogue fills
  // both in from the make+model (a Leaf is electric, an excavator is not a
  // sedan), and these are what stop it filling in over an answer the host
  // already gave by hand — same "suggested until touched" pattern as the
  // currency and hourly rate below. Overwriting a deliberate choice is worse
  // than never having suggested anything: the host corrects the field, the
  // suggestion puts it back, and the form looks broken.
  const [fuelTouched, setFuelTouched] = useState(false);
  const [categoryTouched, setCategoryTouched] = useState(false);
  // A car is priced by the day or by the hour — never both.
  const [pricingMode, setPricingMode] = useState<'daily' | 'hourly'>('daily');
  const [pricePerDay, setPricePerDay] = useState('40000');
  // Defaults to the account country's currency until the host picks their
  // own — same "suggested until touched" pattern as the hourly rate below.
  const [priceCurrency, setPriceCurrency] = useState('');
  const [priceCurrencyTouched, setPriceCurrencyTouched] = useState(false);
  // Tracks whether the host has typed their own hourly rate, so it can keep
  // suggesting one (day / 24) without clobbering an edit — the suggestion
  // only really matters right after switching modes, when there's often
  // already a day price to base it on.
  const [pricePerHourTouched, setPricePerHourTouched] = useState(false);
  const [pricePerHour, setPricePerHour] = useState('1667');
  const [overageMultiplier, setOverageMultiplier] = useState('2');
  const [city, setCity] = useState('');
  const [location, setLocation] = useState('');
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [locationUrl, setLocationUrl] = useState('');
  const [resolvingLink, setResolvingLink] = useState(false);
  const [status, setStatus] = useState<'available' | 'maintenance'>('available');
  const [maintenanceUntil, setMaintenanceUntil] = useState('');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [features, setFeatures] = useState('');
  // Both default on for a brand-new car — most hosts want the platform's own
  // rail and nothing more — except `acceptsCash`, which stays off by default
  // everywhere else in the app (nobody is volunteered for handling cash).
  const [acceptsOnline, setAcceptsOnline] = useState(true);
  const [acceptsCash, setAcceptsCash] = useState(false);
  // Only nag about what's missing after the host actually tries to submit —
  // showing a checklist of everything blank the moment the page loads would
  // just be noise on an empty form.
  const [submitAttempted, setSubmitAttempted] = useState(false);

  /**
   * Which stage of the listing we are on, and which way we last moved.
   *
   * One long page asked a host for thirty things at once and answered none of
   * them; the form was the whole job, visible all at the same time, and the
   * only feedback was a greyed-out Publish at the bottom with a list of
   * everything still wrong. Five stages ask for one thing at a time, say why
   * each is wanted, and refuse to advance until that stage is actually
   * answerable — so a mistake is caught on the screen that can fix it.
   *
   * `dir` is only for the animation: forward slides in from the right, Back
   * from the left, which is what makes the movement read as a place you are in
   * rather than a repaint.
   */
  const [step, setStep] = useState(1);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');

  async function onPickPhotos(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow re-picking the same file
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const urls = await client.uploadPhotos(files);
      setPhotoUrls((prev) => [...prev, ...urls]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not upload the photos.');
    } finally {
      setUploading(false);
    }
  }

  /** Reads the pin straight out of a pasted Google Maps link — long-form
   * links carry the coordinate in the URL itself; a short link (goo.gl/maps,
   * maps.app.goo.gl) has to be resolved server-side first, since a browser
   * can't read a cross-origin redirect's final URL. Leaves the map picker as
   * the fallback for anything this can't read (a place name with no
   * coordinate in the link, a non-Maps link, a resolve failure). */
  async function setPinFromLocationUrl() {
    const url = normalizeUrl(locationUrl);
    if (!url || !isGoogleMapsLink(url)) return;
    setResolvingLink(true);
    try {
      const resolved = isShortMapsLink(url) ? await client.resolveMapsLink(url) : url;
      const point = extractLatLngFromMapsUrl(resolved);
      if (point) {
        setCoords(point);
        toast.success('Pin set from the link.');
      } else {
        toast.error("That link doesn't have a location AutoHire can read — search or click the map instead.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't read that link.");
    } finally {
      setResolvingLink(false);
    }
  }

  // Prefill once when editing and the listing has loaded.
  const existing = existingQuery.data;
  useEffect(() => {
    if (!existing) return;
    setTitle(existing.title);
    setMake(existing.make);
    setModel(existing.model);
    setYear(String(existing.year));
    setCategory(existing.category);
    setSeats(String(existing.seats));
    setTransmission(existing.transmission);
    setFuel(existing.fuel);
    // A saved listing's fuel and category ARE the host's answer, however they
    // were arrived at. Marking them touched is what stops the catalogue
    // "correcting" a published diesel Hilux to petrol the moment its owner
    // opens the edit form to change the price.
    setFuelTouched(true);
    setCategoryTouched(true);
    setPricingMode(existing.pricingMode);
    if (existing.pricePerDayRwf != null) setPricePerDay(String(existing.pricePerDayRwf));
    setPriceCurrency(existing.priceCurrency);
    setPriceCurrencyTouched(true);
    if (existing.pricePerHourRwf != null) {
      setPricePerHour(String(existing.pricePerHourRwf));
      setPricePerHourTouched(true);
    }
    setOverageMultiplier(String(existing.overageMultiplier));
    setCity(existing.city);
    setLocation(existing.location);
    setCoords(existing.lat != null && existing.lng != null ? { lat: existing.lat, lng: existing.lng } : null);
    setLocationUrl(existing.locationUrl ?? '');
    setStatus(existing.status);
    setMaintenanceUntil(existing.maintenanceUntil ?? '');
    setPhotoUrls(existing.photos);
    setFeatures(existing.features.join(', '));
    setAcceptsOnline(existing.acceptsOnline);
    setAcceptsCash(existing.acceptsCash);
  }, [existing]);

  // Country still drives the city list and the default currency (RW→RWF,
  // AE→AED, CN→CNY, US→USD) — a car still can't end up in a market the host
  // doesn't operate in. Currency itself is now a field: a host taking foreign
  // bookings (e.g. a UAE host pricing in USD for tourists) can override the
  // suggestion, same pattern as the hourly rate below.
  const selectedCountry = countries.find((c) => c.code === accountCountry);
  const suggestedCurrency = selectedCountry?.currency ?? 'RWF';
  const currency = priceCurrencyTouched ? priceCurrency : suggestedCurrency;
  /**
   * What the currency picker offers: PayHold's collectible list, plus whatever
   * this car is priced in today.
   *
   * The second half matters on edit. A `<select>` whose `value` is absent from
   * its options renders as the first option instead, so a listing priced in a
   * currency PayHold has since stopped collecting would silently reprice
   * itself the moment its host opened the edit form to change something else.
   * It stays in the list so the change is theirs to make, not ours to make for
   * them. The market suggestion is included on the same reasoning.
   */
  const currencyOptions = useMemo(() => {
    const codes = currencies.map((c) => c.currency);
    return [...new Set([...codes, suggestedCurrency, ...(currency ? [currency] : [])])].sort();
  }, [currencies, suggestedCurrency, currency]);
  const cities = accountCountry ? citiesFor(accountCountry) : [];

  // Default the city once the account country is known — but only for a new
  // listing. In edit mode the prefill effect above already set the existing
  // listing's city, and that shouldn't be clobbered just because the list
  // reloaded.
  useEffect(() => {
    if (editing || !accountCountry) return;
    setCity((prev) => (cities.includes(prev) ? prev : (cities[0] ?? '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountCountry, editing]);

  /**
   * Every make and model the platform knows about, and what this one is.
   *
   * The picker used to offer 57 hardcoded models, which is not a catalogue —
   * it is a shortlist, and a host whose car was not on it got no help at all.
   * `useVehicleCatalogue` never throws and answers `[]` while it loads, so the
   * form works the same whether the catalogue arrives, arrives late, or does
   * not arrive: the fields are plain text inputs with suggestions attached,
   * not a closed list. That is deliberate. Real listings include a Caterpillar
   * 320, a John Deere S780 and a Grove GMK3060, and the first host to list
   * something nobody has listed before must still be able to type it in.
   */
  const { entries: catalogue, isLoading: catalogueLoading } = useVehicleCatalogue();

  /**
   * The model box reaches past what AutoHire has ever listed.
   *
   * The catalogue above is the fleet plus a curated seed — a few hundred
   * entries, which is a shortlist, not a catalogue. This is the world: ~11,700
   * models from Wikidata, searched on the server and debounced there, so the
   * first host to bring a Peugeot 3008 finds it in the box instead of being
   * told their car isn't a car.
   *
   * The query carries the make when there is one, because the index is keyed
   * on both the bare label and "make model" — "Toyota coro" and "coro" both
   * land, and the make narrows models whose name is an ordinary word.
   */
  const modelQuery = model.trim() ? `${make.trim()} ${model.trim()}`.trim() : '';
  const { entries: worldModels, isLoading: searchingModels } = useVehicleSearch(modelQuery, {
    limit: 8,
  });

  /**
   * What this vehicle is, from whichever layer knows it.
   *
   * The fleet first: only it carries an AutoHire body category, and its fuel is
   * evidence from listings rather than an encyclopaedia's guess. The world
   * catalogue second, so a model nobody here has listed yet still auto-fills
   * the one thing it does know — whether the thing is electric.
   */
  const catalogueHit: CatalogueEntry | null = useMemo(
    () => lookupVehicle(catalogue, make, model) ?? lookupVehicle(worldModels, make, model),
    [catalogue, worldModels, make, model],
  );

  /**
   * Fill in fuel and category from the catalogue once make+model identify the
   * vehicle — the "is it electric?" question answered from what the model
   * actually is, rather than left on the `petrol` default for a Leaf.
   *
   * It runs on the match, not on the click, so typing "Nissan" / "Leaf" by
   * hand gets the same answer as picking the row from the list. `*Touched`
   * guards both fields: a host who has chosen is never overruled.
   */
  useEffect(() => {
    if (!catalogueHit) return;
    if (!fuelTouched && catalogueHit.fuel) setFuel(catalogueHit.fuel);
    if (!categoryTouched && catalogueHit.category) setCategory(catalogueHit.category);
  }, [catalogueHit, fuelTouched, categoryTouched]);

  // Suggest an hourly rate from the day price (day / 24) until the host types
  // their own — the two prices are independent once touched.
  useEffect(() => {
    if (pricePerHourTouched) return;
    const day = Number(pricePerDay);
    if (day > 0) setPricePerHour(String(Math.round(day / 24)));
  }, [pricePerDay, pricePerHourTouched]);

  // A tractor has a cab, not seats, and runs on power, not fuel — relabel the shared
  // fields rather than maintaining a second form for machinery.
  const machine = isMachine(category);

  /**
   * Cars must be a model that exists. Machinery must not have to be.
   *
   * Production carried listings for a "Ferrari 2000 Y" and a "Lamborghini
   * Model4" — neither is a car (both have since been corrected to real
   * models). A free-text model box is how they got there, and each was a
   * listing a renter could never find, because renters search for models that
   * exist. So for a car the make+model has to be one the world catalogue
   * recognises.
   *
   * Machinery is the opposite case and the same form. There is no usable
   * public catalogue of excavators, cranes or forklifts — Wikidata has
   * thousands of car models and *none* of these — so demanding a pick would
   * make half the platform unlistable. There, the catalogue is a shortcut and
   * nothing more.
   *
   * **It fails open, three separate ways**, because the cost of a wrong "no"
   * here is a host with a real car who cannot list it at all:
   * - `useIsKnownCarModel` answers `'unknown'` — not `false` — while it is
   *   still checking and whenever the index is unreachable. Only a definite
   *   `false` refuses anything.
   * - A make+model the FLEET already carries counts as real whatever Wikidata
   *   says. Wikidata has no Nissan Patrol, which is one of the commonest SUVs
   *   in a market this platform actually serves, and it files the MG4 under
   *   "MG 4 EV". Hosts here have listed both.
   * - A car already saved with a model the check rejects still has to be
   *   editable. Its owner changing the price must not be held hostage to a
   *   model they can no longer submit — it is flagged, not blocked, until they
   *   touch the make or model themselves.
   */
  /**
   * The pair actually sent for checking, a beat behind the keystrokes.
   *
   * `useIsKnownCarModel` caches per make+model, which means every keystroke is
   * a distinct query and a distinct request: typing "Corolla" would ask the
   * index seven questions, six of them about strings the host was in the
   * middle of. The search endpoint debounces itself for exactly this reason;
   * this check does not, so it is debounced here instead of being hammered.
   */
  const [checkedPair, setCheckedPair] = useState({ make: '', model: '' });
  useEffect(() => {
    const t = setTimeout(() => setCheckedPair({ make, model }), 400);
    return () => clearTimeout(t);
  }, [make, model]);
  const { known: carModelKnown, isChecking: checkingCarModel } = useIsKnownCarModel(
    // Never ask about machinery: Wikidata models tractors thinly and
    // excavators, cranes and forklifts not at all, so every Caterpillar and
    // Grove on the platform would come back `false` — a correct answer to a
    // question nobody asked.
    machine ? '' : checkedPair.make,
    machine ? '' : checkedPair.model,
  );
  /** The answer is about what was typed 400ms ago; ignore it if that has moved on. */
  const checkIsCurrent = checkedPair.make === make && checkedPair.model === model;
  const sameAsSaved =
    !!existing &&
    existing.make.trim().toLowerCase() === make.trim().toLowerCase() &&
    existing.model.trim().toLowerCase() === model.trim().toLowerCase();
  const unknownCarModel =
    !machine &&
    !!make.trim() &&
    !!model.trim() &&
    checkIsCurrent &&
    carModelKnown === false &&
    !catalogueHit;
  /** Flagged but not blocked: a listing that was already saved this way. */
  const grandfatheredModel = unknownCarModel && sameAsSaved;

  /**
   * Platform electric quota: a car that is neither electric NOR HYBRID can
   * only be listed while the fleet stays at or above the threshold. Machinery
   * is exempt.
   *
   * Hybrids began counting on 2026-09-14 (migration 098) and the DB trigger
   * that actually enforces this accepts both. This screen has to agree with
   * it in both directions — a form that refuses a hybrid the database would
   * have taken is a host turned away for nothing, and one that accepts a
   * petrol car the trigger will reject is six stages of work thrown away at
   * the last step.
   */
  const { data: quota } = useQuery({
    queryKey: ['electricQuota'],
    queryFn: () => client.getElectricQuota(),
  });
  const qualifyingFuel = fuel === 'electric' || fuel === 'hybrid';
  const blockedNonElectric = !machine && !qualifyingFuel && !!quota && !quota.canAddNonElectric;

  const today = new Date().toISOString().slice(0, 10);
  // In maintenance requires a valid back-in-service date (today or later).
  const statusValid = status === 'available' || (!!maintenanceUntil && maintenanceUntil >= today);

  const mutation = useMutation({
    mutationFn: (input: CreateListingInput) =>
      editing ? client.updateListing(editId!, input) : client.createListing(input),
    onSuccess: (listing) => {
      queryClient.invalidateQueries({ queryKey: ['ownerListings'] });
      queryClient.invalidateQueries({ queryKey: ['ownerHost'] });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      queryClient.invalidateQueries({ queryKey: ['listing', editId] });
      navigate(`/cars/${editing ? editId : listing?.id}`);
    },
  });

  // What's stopping Publish, in plain language — and WHICH step it belongs to,
  // so the wizard can say it on the screen that can fix it rather than saving
  // every complaint for the end. The flat `missing` below is still what the
  // review step lists; this is the same set with a step attached.
  const blockers: { step: number; text: string }[] = [];
  const need = (step: number, text: string) => blockers.push({ step, text });

  if (!accountCountry) need(1, 'your account country (set it on the Account page)');
  if (!title.trim()) need(1, 'a listing title');
  if (!make.trim()) need(1, 'the make');
  if (!model.trim()) need(1, machine ? 'the model' : 'the model — pick it from the list');
  // Name the fact, then the action. "Invalid model" tells a host nothing they
  // can do; the model they typed, and where to find the real one, does.
  if (unknownCarModel && !grandfatheredModel)
    need(
      1,
      `a model AutoHire knows — “${make.trim()} ${model.trim()}” isn’t one. Type in the Model box and pick from the list.`,
    );
  if (!(Number(year) > 1980)) need(1, 'a valid year');
  if (!(Number(seats) > 0)) need(1, machine ? 'cab seats' : 'seats');
  if (!location.trim()) need(2, 'the pickup area');
  // The text field alone isn't enough to plot on the map — without real
  // coordinates a listing simply never gets a pin (ResultsMap only plots
  // listings that have lat/lng), so a renter searching the map never finds
  // it even though it exists. The map picker (search, click, or drag) is
  // how a host actually sets this; the Google Maps link field stays
  // optional, since it duplicates the same coordinate once entered.
  if (!coords) need(2, 'an exact pickup point on the map');
  if (pricingMode === 'daily' && !(Number(pricePerDay) > 0)) need(3, 'a price per day');
  if (pricingMode === 'hourly' && !(Number(pricePerHour) > 0)) need(3, 'a price per hour');
  if (pricingMode === 'daily' && !(Number(overageMultiplier) > 0)) need(3, 'a late-return rate');
  if (locationUrl.trim() && !isLikelyUrl(locationUrl)) need(2, 'a valid location link');
  if (!statusValid) need(4, 'a back-in-service date');
  if (blockedNonElectric)
    need(1, 'an electric or hybrid vehicle — the fleet quota is full for other fuel types');
  if (photoUrls.length === 0) need(5, 'at least one photo');
  if (uploading) need(5, 'the photo upload to finish');
  if (!acceptsOnline && !acceptsCash) need(3, 'a way for renters to pay — online, cash, or both');

  const missing = blockers.map((b) => b.text);
  const valid = missing.length === 0;

  /** What this particular step is still waiting on. */
  const blockersOn = (n: number) => blockers.filter((b) => b.step === n).map((b) => b.text);

  /**
   * What the make box offers: every make in the catalogue, most-listed first.
   *
   * Ranked by how many of each are actually listed rather than alphabetically
   * — "Toyota" being the first thing a Rwandan host sees is worth more than
   * "Abarth" being.
   */
  const makeSuggestions = useMemo(() => {
    const byMake = new Map<string, Suggestion>();
    for (const e of catalogue) {
      const key = e.make.trim().toLowerCase();
      if (!key) continue;
      const at = byMake.get(key);
      if (at) at.count += e.count;
      else byMake.set(key, { key, make: e.make, fuel: null, category: null, count: e.count });
    }
    return pickSuggestions([...byMake.values()], make, (s) => [s.make]);
  }, [catalogue, make]);

  /**
   * What the model box shows: what the platform knows first, then the world.
   *
   * Fleet entries lead because they carry a real fuel AND a real category — a
   * Wikidata row knows a model exists and often what it burns, but nothing
   * about AutoHire's body categories, so picking one fills in less. Ordering
   * by layer rather than by match quality means the row that auto-fills the
   * most is the row nearest the finger.
   */
  const modelSuggestions = useMemo(() => {
    const mk = make.trim().toLowerCase();
    const scoped = mk ? catalogue.filter((e) => e.make.trim().toLowerCase() === mk) : [];
    const pool = scoped.length > 0 ? scoped : catalogue;
    const toRow = (e: CatalogueEntry): Suggestion => ({
      key: `${e.make}|${e.model}`,
      make: e.make,
      model: e.model,
      fuel: e.fuel,
      category: e.category,
      count: e.count,
      world: e.source === 'wikidata',
    });
    const local = pickSuggestions(
      pool.map(toRow),
      model,
      (s) => [s.model ?? '', `${s.make} ${s.model ?? ''}`],
      // Leave room for the world results rather than filling the list with
      // near-misses from a few hundred entries and hiding the exact match that
      // came back from the search.
      worldModels.length > 0 ? 5 : 10,
    );
    const seen = new Set(local.map((s) => s.key.toLowerCase()));
    const rest = worldModels
      .map(toRow)
      .filter((s) => !seen.has(s.key.toLowerCase()))
      .slice(0, 8);
    return [...local, ...rest];
  }, [catalogue, make, model, worldModels]);

  /** What the catalogue has to say about what has been typed so far. */
  const catalogueNote = useMemo(() => {
    if (catalogueHit) {
      const filled = [
        !fuelTouched && catalogueHit.fuel ? FUEL_LABEL[catalogueHit.fuel].toLowerCase() : null,
        !categoryTouched && catalogueHit.category ? CATEGORY_LABEL[catalogueHit.category] : null,
      ].filter(Boolean);
      const what = `${catalogueHit.make} ${catalogueHit.model}`;
      return filled.length > 0
        ? `${what} is ${filled.join(', ')} — filled in below. Change either if yours differs.`
        : `${what} — found in the catalogue.`;
    }
    if (catalogueLoading) return 'Loading the model catalogue…';
    if (machine && make.trim() && model.trim())
      return 'Not in the catalogue — normal for machinery. Set the power and category yourself.';
    // Say it is still looking rather than leaving the line blank: this is the
    // gap where the answer is "we don't know yet", and an empty space there
    // reads as "nothing to say about your car".
    if (
      !machine &&
      make.trim() &&
      model.trim() &&
      (searchingModels || checkingCarModel || !checkIsCurrent)
    )
      return 'Checking the model…';
    if (!machine && checkIsCurrent && carModelKnown === true && make.trim() && model.trim())
      return `${make.trim()} ${model.trim()} is a real model — AutoHire just hasn’t had one listed yet, so set the fuel and category below yourself.`;
    if (!make.trim() && !model.trim())
      return machine
        ? 'Type the make and model. If the catalogue knows it, the power and category fill in.'
        : 'Type a make or model and pick yours from the list — fuel and category fill in from it.';
    return null;
  }, [
    catalogueHit,
    catalogueLoading,
    fuelTouched,
    categoryTouched,
    machine,
    make,
    model,
    searchingModels,
    checkingCarModel,
    checkIsCurrent,
    carModelKnown,
  ]);

  // The required marks are on screen from the start; they only turn red once
  // the host has tried to move on and the field is still empty.
  const showMissing = submitAttempted;

  /** Jump to an already-completed stage. Backwards only — see `StepNav`. */
  const goToStep = (n: number) => {
    setDir('back');
    setStep(n);
  };

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!valid || !accountCountry) return;
    mutation.mutate({
      title: title.trim(),
      category,
      make: make.trim(),
      model: model.trim(),
      year: Number(year),
      seats: Number(seats),
      transmission,
      fuel,
      pricingMode,
      // Both prices are kept even when their mode is off, so switching back
      // doesn't lose what was typed — the database only requires the ACTIVE
      // mode's price to be set, and only the active one is ever charged.
      pricePerDayRwf: Number(pricePerDay) > 0 ? Number(pricePerDay) : null,
      priceCurrency: currency,
      pricePerHourRwf: Number(pricePerHour) > 0 ? Number(pricePerHour) : null,
      overageMultiplier: Number(overageMultiplier),
      country: accountCountry,
      location: location.trim(),
      city,
      photos: photoUrls,
      features: toList(features),
      bookingMode: 'instant',
      status,
      maintenanceUntil: status === 'maintenance' ? maintenanceUntil : null,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      locationUrl: locationUrl.trim() ? normalizeUrl(locationUrl) : null,
      acceptsOnline,
      acceptsCash,
    });
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        to="/dashboard"
        className="mb-4 -ml-1 inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-1 text-body-sm text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
      >
        <ArrowLeft size={16} /> Back to dashboard
      </Link>

      {/* Two columns once there is room for two.
          At 1440 a 736px form sat in the middle of 700px of nothing, which is
          a phone layout that has been allowed to grow margins. The stages are
          the natural second column: on a wide screen they stop being a strip
          above the form and become a contents page beside it, in view the
          whole way down, and the form itself gets the width its side-by-side
          fields were written for. */}
      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-10 xl:grid-cols-[17rem_minmax(0,1fr)] xl:gap-16">
        <aside className="lg:sticky lg:top-8">
          <h1 className="text-h2 text-[var(--color-content)]">
            {editing ? 'Edit your listing' : 'List your vehicle or machine'}
          </h1>
          <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">
            {editing
              ? 'Update the details, photos, location and availability.'
              : 'Rent out a car, a tractor or an excavator. Your first listing turns your account into a host.'}
          </p>
          <p className="mt-6 hidden text-caption font-medium uppercase tracking-wide text-[var(--color-content-subtle)] lg:block">
            Step {step} of {STEPS.length}
          </p>
          <StepNav step={step} onGo={goToStep} variant="rail" />
        </aside>

        <div className="min-w-0">
      {editing && existingQuery.isLoading ? (
        <ListCarSkeleton />
      ) : (
      <form onSubmit={onSubmit} className="mt-6 lg:mt-0">
        {/* The map of the job, before the job.
            A host arriving at a long form cannot tell whether it is five
            minutes or fifty. Six named stages with the current one marked
            answers that in one glance, and a finished stage is clickable so
            going back to fix something is one tap rather than a scroll hunt. */}
        <StepNav step={step} onGo={goToStep} variant="track" />

        {/* `key={step}` is what replays the animation: React tears the old
            stage down and mounts the new one, so the CSS runs again. */}
        <div
          key={step}
          className={cn('space-y-6', dir === 'fwd' ? 'animate-step-in' : 'animate-step-back')}
        >
        <p className="text-body-sm text-[var(--color-content-muted)]">{STEP_BLURB[step - 1]}</p>

        {step === 1 && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-[var(--color-content)]">{machine ? 'The machine' : 'The car'}</h2>
          </CardHeader>
          <CardBody className="space-y-4 sm:space-y-5">
            <div>
              <Label htmlFor="title">
                Listing title <Req missing={showMissing && !title.trim()} />
              </Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-required
                aria-invalid={showMissing && !title.trim()}
                className={cn(showMissing && !title.trim() && invalidField)}
                placeholder={
                  machine
                    ? 'Kubota T1400 — tiller for hire near Kigali'
                    : 'Toyota RAV4 — great for Kigali & trips'
                }
              />
            </div>
            {/* Make, model and category together, because they are one
                question — "what is this thing?" — and because the first two
                answer the third from the catalogue. Full width each on a
                phone: a machine's model ("GMK3060", "S780 Combine") does not
                survive a 150px box. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="make">
                  Make <Req missing={showMissing && !make.trim()} />
                </Label>
                <CatalogueCombobox
                  id="make"
                  value={make}
                  onChange={setMake}
                  onPick={(s) => setMake(s.make)}
                  suggestions={makeSuggestions}
                  loading={catalogueLoading}
                  invalid={showMissing && !make.trim()}
                  placeholder={machine ? 'Kubota' : 'Toyota'}
                  label="Makes"
                  emptyNote={`No make called “${make.trim()}”. Type it in full — the model box searches on its own.`}
                />
              </div>
              <div>
                <Label htmlFor="model">
                  Model <Req missing={showMissing && !model.trim()} />
                </Label>
                <CatalogueCombobox
                  id="model"
                  value={model}
                  onChange={setModel}
                  // Picking a model settles the make too — the row says
                  // "Toyota RAV4", and a host who picked it from a search that
                  // ignored the make field should not then be told the make is
                  // missing.
                  onPick={(s) => {
                    setMake(s.make);
                    setModel(s.model ?? '');
                    // Apply what the row itself knows, now, rather than waiting
                    // for the lookup to re-derive it: picking a world row
                    // changes the search query, so for a moment the only thing
                    // that knows this model is electric is the row that was
                    // just tapped.
                    if (!fuelTouched && s.fuel) setFuel(s.fuel);
                    if (!categoryTouched && s.category) setCategory(s.category);
                  }}
                  suggestions={modelSuggestions}
                  loading={catalogueLoading || searchingModels}
                  invalid={(showMissing && !model.trim()) || (showMissing && unknownCarModel && !grandfatheredModel)}
                  verified={!!catalogueHit}
                  placeholder={machine ? 'T1400' : 'RAV4'}
                  label="Models"
                  // The same empty result means opposite things either side of
                  // `machine`, so it must not say the same sentence. A crane
                  // nobody has listed is expected — no catalogue on earth holds
                  // Grove model numbers — and the honest answer is "type it".
                  // A car nobody can find is usually a typo, and saying "keep
                  // typing" there walks a host into a listing that will be
                  // refused six stages later.
                  emptyNote={
                    machine
                      ? `No match for “${model.trim()}” — type it in full and carry on, machinery isn’t in the catalogue.`
                      : make.trim()
                        ? `No car called “${make.trim()} ${model.trim()}”. Check the spelling, or try the model on its own.`
                        : `No car called “${model.trim()}”. Check the spelling, or fill in the make first.`
                  }
                />
              </div>
              <div>
                <Label htmlFor="category">Category</Label>
                <Select
                  id="category"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value as CarCategory);
                    setCategoryTouched(true);
                  }}
                >
                  {CATEGORY_GROUPS.map((group) => (
                    <optgroup key={group} label={group}>
                      {CAR_CATEGORIES.filter((c) => c.group === group).map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </div>
            </div>

            {/* Say what the catalogue just did, or that it had nothing to say.
                An electric car whose fuel silently flipped to Electric looks
                like a bug; the same thing announced reads as help — and the
                "not in the catalogue" line is what tells a host listing a
                Grove crane that typing it in is expected, not a mistake. */}
            {catalogueNote && (
              <p className="flex items-start gap-1.5 text-caption text-[var(--color-content-subtle)]">
                <Zap
                  size={12}
                  className={cn(
                    'mt-0.5 shrink-0',
                    catalogueHit ? 'text-[var(--color-accent-on)]' : 'text-[var(--color-content-subtle)]',
                  )}
                />
                <span className="min-w-0">{catalogueNote}</span>
              </p>
            )}

            {/* A car that is not a car. Said on the stage that can fix it, the
                moment it is true — a host who only meets this next to the
                Publish button has already filled in five more stages for a
                listing that was never going to be published. */}
            {unknownCarModel && (
              <Notice tone="warn" className="flex-col items-stretch">
                <p className="font-medium">
                  “{make.trim()} {model.trim()}” isn’t a car AutoHire knows.
                </p>
                <p className="mt-0.5">
                  {grandfatheredModel
                    ? 'This listing was saved before models were checked, so your other changes will still save. Renters search by real model names, though — picking yours from the Model box is how they find this car.'
                    : 'Renters search by model, so a made-up one is a listing nobody finds. Type in the Model box above and pick yours from the list. Machinery is exempt — set the category to a tractor, excavator, crane or forklift and you can type its model freely.'}
                </p>
              </Notice>
            )}

            {/* Four short answers, two to a row on a phone rather than four
                full-width boxes: a number pad and a two-option dropdown do not
                need 358px, and the stage was eight scroll-lengths long. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              <div>
                <Label htmlFor="year">Year</Label>
                <Input
                  id="year"
                  type="number"
                  inputMode="numeric"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="seats">{machine ? 'Cab seats' : 'Seats'}</Label>
                <Input
                  id="seats"
                  type="number"
                  inputMode="numeric"
                  value={seats}
                  onChange={(e) => setSeats(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="transmission">{machine ? 'Drive' : 'Transmission'}</Label>
                <Select
                  id="transmission"
                  value={transmission}
                  onChange={(e) => setTransmission(e.target.value as Transmission)}
                >
                  <option value="automatic">Automatic</option>
                  <option value="manual">Manual</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="fuel">{machine ? 'Power' : 'Fuel'}</Label>
                <Select
                  id="fuel"
                  value={fuel}
                  onChange={(e) => {
                    setFuel(e.target.value as FuelType);
                    setFuelTouched(true);
                  }}
                >
                  {FUELS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="features">Features</Label>
              <Input
                id="features"
                value={features}
                onChange={(e) => setFeatures(e.target.value)}
                placeholder="Air conditioning, Bluetooth, Backup camera"
              />
              <p className="mt-1 text-caption text-[var(--color-content-subtle)]">Separate with commas.</p>
            </div>
          </CardBody>
        </Card>
        )}

        {step === 2 && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-[var(--color-content)]">Location</h2>
            <p className="mt-0.5 text-body-sm text-[var(--color-content-muted)]">Where renters pick it up.</p>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <Label>Country</Label>
              {accountCountry ? (
                <>
                  <div className="flex h-10 items-center rounded-[var(--radius-control)] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-3 text-body-sm text-[var(--color-content)]">
                    {selectedCountry?.flag} {selectedCountry?.name ?? accountCountry}
                  </div>
                  {/* The second half is background, not instruction, and on a
                      phone four lines of grey text between two fields is what
                      makes a form feel long. It keeps its place on a screen
                      with the room for it. */}
                  <p className="mt-1 text-caption text-[var(--color-content-subtle)]">
                    Where the car is located. This follows your account's country — change it on
                    the{' '}
                    <Link to="/account" className="text-[var(--color-accent-on)] hover:underline">
                      Account
                    </Link>{' '}
                    page, not per listing.
                    <span className="hidden sm:inline">
                      {' '}
                      The price currency below can still differ — useful if you mostly book
                      foreign renters.
                    </span>
                  </p>
                </>
              ) : (
                <Notice tone="warn">
                  Set your country on the{' '}
                  <Link to="/account" className="font-medium underline">
                    Account
                  </Link>{' '}
                  page before listing a car — that's where it'll be listed.
                </Notice>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="city">City</Label>
                <Select id="city" value={city} onChange={(e) => setCity(e.target.value)}>
                  {cities.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="location">
                  Pickup area <Req missing={showMissing && !location.trim()} />
                </Label>
                <Input
                  id="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  aria-required
                  aria-invalid={showMissing && !location.trim()}
                  className={cn(showMissing && !location.trim() && invalidField)}
                  placeholder="Kimihurura, Kigali"
                />
              </div>
            </div>
            <div>
              <Label>
                Pickup point on the map <Req missing={showMissing && !coords} />
              </Label>
              <LocationPicker
                value={coords}
                onChange={setCoords}
                onAddress={(address) => {
                  // Fill the pickup-area text from the search if it's still empty.
                  if (!location.trim()) setLocation(address.split(',').slice(0, 2).join(',').trim());
                }}
              />
              {/* The picker says how to place the pin directly underneath
                  itself; repeating that here was three lines saying what the
                  three lines above them just said. What it does not say is
                  why the pin matters, which is the half worth keeping. */}
              <p className="mt-1 text-caption text-[var(--color-content-subtle)]">
                This pin is what puts the car on renters' maps. The link below is for arrival
                instructions, not a substitute for it.
              </p>
            </div>
            <div>
              <Label htmlFor="location-url">Location link (optional)</Label>
              {/* Stacked on a phone: side by side, "Set pin from link" left a
                  URL field about 180px wide, which is not enough of a link to
                  recognise — and the one thing a host does here is check they
                  pasted the right one. */}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="location-url"
                  type="url"
                  inputMode="url"
                  value={locationUrl}
                  onChange={(e) => setLocationUrl(e.target.value)}
                  placeholder="https://maps.google.com/…  or a directions/instructions link"
                  // `sm:flex-1`, not `flex-1`: the row is a COLUMN on a phone,
                  // where flex-1 sets the basis on the main axis — the height
                  // — and collapsed this field to 17px.
                  className="min-w-0 sm:flex-1"
                />
                {isGoogleMapsLink(normalizeUrl(locationUrl)) && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={() => void setPinFromLocationUrl()}
                    disabled={resolvingLink}
                  >
                    {resolvingLink ? '…' : 'Set pin from link'}
                  </Button>
                )}
              </div>
              <p className="mt-1 text-caption text-[var(--color-content-subtle)]">
                A Google Maps share link, What3Words, or any page with arrival instructions.
                <span className="hidden sm:inline">
                  {' '}
                  Renters can open it when heading to pickup — and a Google Maps link can set the
                  pickup pin above directly, long or shortened.
                </span>
              </p>
              {locationUrl.trim() && !isLikelyUrl(locationUrl) && (
                <p className="mt-1 text-body-sm text-[var(--color-danger-500)]">That doesn't look like a valid link.</p>
              )}
            </div>
          </CardBody>
        </Card>
        )}

        {step === 3 && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-[var(--color-content)]">Pricing</h2>
            <p className="mt-0.5 text-body-sm text-[var(--color-content-muted)]">
              Choose how this {machine ? 'machine' : 'car'} is booked — by the day, or by the hour.
            </p>
          </CardHeader>
          <CardBody className="space-y-5">
            <div>
              <Label>Booking type</Label>
              {/* Thumb-width on a phone, but capped once there is room: a
                  two-option toggle stretched across 700px of desktop reads as
                  two buttons that do unrelated things, not one choice. */}
              <div className="flex gap-2">
                <Chip
                  selected={pricingMode === 'daily'}
                  onClick={() => setPricingMode('daily')}
                  className="flex-1 justify-center sm:max-w-40"
                >
                  Per day
                </Chip>
                <Chip
                  selected={pricingMode === 'hourly'}
                  onClick={() => setPricingMode('hourly')}
                  className="flex-1 justify-center sm:max-w-40"
                >
                  Per hour
                </Chip>
              </div>
              <p className="mt-1.5 text-caption text-[var(--color-content-subtle)]">
                {pricingMode === 'hourly'
                  ? 'Renters pay a 50% deposit up front and are settled against actual pickup-to-return time — no day price on this car.'
                  : 'Renters book by the calendar day, paid in full up front.'}
              </p>
            </div>

            {/* A price and a currency code. Neither needs half of a desktop
                column, and a field sized far past its longest plausible value
                is a field that looks like it is expecting something else. */}
            <div className="grid grid-cols-1 gap-4 sm:max-w-lg sm:grid-cols-[minmax(0,1fr)_11rem]">
              {pricingMode === 'daily' ? (
                <div>
                  <Label htmlFor="price">Price per day</Label>
                  <Input
                    id="price"
                    type="number"
                    value={pricePerDay}
                    onChange={(e) => setPricePerDay(e.target.value)}
                  />
                </div>
              ) : (
                <div>
                  <Label htmlFor="price-per-hour">Price per hour</Label>
                  <Input
                    id="price-per-hour"
                    type="number"
                    value={pricePerHour}
                    onChange={(e) => {
                      setPricePerHour(e.target.value);
                      setPricePerHourTouched(true);
                    }}
                  />
                </div>
              )}
              <div>
                <Label htmlFor="price-currency">Currency</Label>
                {/* **PayHold's collectible currencies, not ours.**
                    This listed `Object.keys(CURRENCIES)` — the four markets
                    hardcoded in `lib/currency.ts`. That is a list of the
                    places AutoHire sells in, which is not the question this
                    control asks: it asks what a renter can be *charged*, and
                    only PayHold knows that. The two came apart in both
                    directions — a host could price a car in a currency no
                    rail can collect, leaving a listing nobody is able to
                    book, and a currency PayHold had since added could not be
                    chosen at all. `currencies` is PayHold's own
                    `payment-options` list (see lib/country.tsx).

                    Which is also why this is no longer a `<select>`: that
                    list is 141 codes today and grows with every market
                    PayHold opens, and a native select has no search — see
                    `CurrencyCombobox`. */}
                <CurrencyCombobox
                  id="price-currency"
                  value={currency}
                  onChange={(code) => {
                    setPriceCurrency(code);
                    setPriceCurrencyTouched(true);
                  }}
                  options={currencyOptions}
                  suggested={suggestedCurrency}
                />
              </div>
            </div>

            {pricingMode === 'daily' && (
              <div className="border-t border-[var(--color-line)] pt-5">
                <Label htmlFor="overage-multiplier">Late-return rate</Label>
                <p className="mb-1.5 text-caption text-[var(--color-content-muted)]">
                  A car returned more than 2 hours past the agreed time is billed extra for the
                  hours over, at a multiple of an implied hourly price (day price ÷ 24).
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    id="overage-multiplier"
                    type="number"
                    step="0.1"
                    min="0"
                    className="max-w-28"
                    value={overageMultiplier}
                    onChange={(e) => setOverageMultiplier(e.target.value)}
                  />
                  <span className="text-body-sm text-[var(--color-content-muted)]">× hourly price</span>
                </div>
                <p className="tabular mt-1.5 text-caption text-[var(--color-content-subtle)]">
                  {Number(pricePerHour) > 0 && Number(overageMultiplier) > 0
                    ? `Currently ${Math.round(Number(pricePerHour) * Number(overageMultiplier)).toLocaleString()} ${currency} per extra hour, after the grace period.`
                    : ''}{' '}
                  Charged to the renter automatically when they bring it back late. If
                  their payment method can't be charged again, we tell you exactly how
                  much to collect from them.
                </p>
              </div>
            )}
          </CardBody>
        </Card>
        )}

        {step === 3 && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-[var(--color-content)]">How renters pay</h2>
            <p className="mt-0.5 text-body-sm text-[var(--color-content-muted)]">
              Turn on at least one. Both is fine too — the renter picks at checkout.
            </p>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="flex gap-2">
              <Chip
                selected={acceptsOnline}
                onClick={() => {
                  if (acceptsOnline && !acceptsCash) return; // last method standing
                  setAcceptsOnline((v) => !v);
                }}
                className="flex-1 justify-center sm:max-w-44"
              >
                Pay online
              </Chip>
              <Chip
                selected={acceptsCash}
                onClick={() => {
                  if (acceptsCash && !acceptsOnline) return; // last method standing
                  setAcceptsCash((v) => !v);
                }}
                className="flex-1 justify-center sm:max-w-44"
              >
                Cash on pickup
              </Chip>
            </div>
            <p className="text-caption text-[var(--color-content-subtle)]">
              {acceptsOnline && acceptsCash
                ? 'Renters choose either at checkout: card / mobile money / wallet through AutoHire, or cash in person.'
                : acceptsOnline
                  ? 'Renters pay through AutoHire — card, mobile money or wallet, depending on where they are.'
                  : 'Cash-only: renters book without paying online and hand you cash at the handoff. You record what you collected when the car comes back.'}
            </p>
          </CardBody>
        </Card>
        )}

        {step === 4 && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-[var(--color-content)]">Availability</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="grid grid-cols-1 gap-4 sm:max-w-xl sm:grid-cols-2">
              <div>
                <Label htmlFor="status">Status</Label>
                <Select
                  id="status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'available' | 'maintenance')}
                >
                  <option value="available">Available — ready to rent</option>
                  <option value="maintenance">In maintenance — temporarily off</option>
                </Select>
              </div>
              {status === 'maintenance' && (
                <div>
                  <Label htmlFor="maintenance-until">Back in service on</Label>
                  <Input
                    id="maintenance-until"
                    type="date"
                    min={today}
                    value={maintenanceUntil}
                    onChange={(e) => setMaintenanceUntil(e.target.value)}
                  />
                </div>
              )}
            </div>
            <p className="text-caption text-[var(--color-content-subtle)]">
              {status === 'maintenance'
                ? 'Renters can only book trips that start on or after this date.'
                : 'The car is bookable on any free date. Booked dates fill in automatically.'}
            </p>
            {!statusValid && (
              <p className="text-body-sm text-[var(--color-danger-500)]">Pick a back-in-service date (today or later).</p>
            )}
          </CardBody>
        </Card>
        )}

        {step === 5 && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-[var(--color-content)]">Photos</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            {/* The whole block is the button.
                This stage was one native "Choose Files" control — a 34px OS
                widget, alone on the screen, on the stage the blurb calls the
                one that does most of the renting. The target is now the full
                width of the card at any size, which is both the easiest thing
                on the page to hit with a thumb and the only thing on the page
                that looks like it wants to be used. The input itself is still
                a real file input, just not the thing being looked at. */}
            <label
              htmlFor="photos"
              className={cn(
                'flex flex-col items-center justify-center gap-1.5 rounded-[var(--radius-card)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-4 py-7 text-center transition-colors sm:py-9',
                uploading
                  ? 'pointer-events-none opacity-60'
                  : 'cursor-pointer hover:border-[var(--color-accent-on)]',
              )}
            >
              <ImagePlus size={22} className="text-[var(--color-content-subtle)]" aria-hidden />
              <span className="text-body-sm font-semibold text-[var(--color-content)]">
                {photoUrls.length > 0 ? 'Add more photos' : 'Add photos'}
              </span>
              <span className="text-caption text-[var(--color-content-subtle)]">
                JPG or PNG. Upload the best one first — it becomes the cover.
              </span>
            </label>
            <input
              id="photos"
              type="file"
              accept="image/*"
              multiple
              disabled={uploading}
              onChange={onPickPhotos}
              className="sr-only"
            />
            {uploading && <p className="text-caption text-[var(--color-content-muted)]">Uploading…</p>}
            {uploadError && <p className="text-body-sm text-[var(--color-danger-500)]">{uploadError}</p>}
            {photoUrls.length > 0 && (
              // A grid, not a wrapping row of 96px stamps. These are the thing
              // that rents the car, and they were being reviewed at a size
              // where you cannot tell a clean car from a dirty one. The cells
              // divide the column, so they are as large as the screen allows
              // at every width.
              <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-3 lg:grid-cols-4">
                {photoUrls.map((url, i) => (
                  <div key={url} className="relative">
                    <Img
                      src={url}
                      alt=""
                      className="aspect-[4/3] w-full rounded-[var(--radius-control)] border border-[var(--color-line)] object-cover"
                    />
                    {i === 0 && (
                      // Which one renters see first is decided here, silently,
                      // by upload order. Say so while it can still be changed.
                      <span className="absolute bottom-1.5 left-1.5 rounded-[var(--radius-pill)] bg-[var(--color-surface-inverse)]/80 px-2 py-0.5 text-caption font-medium text-[var(--color-content-inverse)]">
                        Cover
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setPhotoUrls((prev) => prev.filter((u) => u !== url))}
                      // h-7: a 20px circle is not a target on a touchscreen,
                      // and deleting the wrong photo is the cost of missing.
                      className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-inverse)]/85 text-[var(--color-content-inverse)] hover:bg-[var(--color-surface-inverse)]"
                      aria-label="Remove photo"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
        )}

        {blockedNonElectric && quota && (
          <Notice tone="brand">
            <Zap size={18} className="mt-0.5 shrink-0" />
            <div className="min-w-0 text-body-sm">
              <p className="font-semibold">Only electric or hybrid cars can be listed right now</p>
              {/* The percentage is `qualifyingCars`, the figure the quota is
                  actually computed from, not `electricCars`. Showing the
                  electric count against a rule that counts hybrids too would
                  read as a fleet further from the threshold than it is — and
                  it is the arithmetic a host checks when they want to argue
                  with the answer. */}
              <p className="mt-0.5">
                AutoHire keeps at least {quota.minPercent}% of its cars electric or hybrid. The
                fleet is at{' '}
                {quota.totalCars > 0
                  ? Math.round((quota.qualifyingCars / quota.totalCars) * 100)
                  : 0}
                % ({quota.qualifyingCars}/{quota.totalCars}
                {quota.hybridCars > 0 ? `, ${quota.hybridCars} of them hybrid` : ''}), so a {fuel}{' '}
                car can’t be added yet. Pick an electric or hybrid model, or set the fuel
                yourself.
              </p>
              {/* The database refuses this on insert, so a host who reads it
                  on the Photos stage and carries on is uploading photos for a
                  listing that cannot exist. The control that fixes it is two
                  stages back, so bring them to it rather than describing where
                  it is. */}
              {step !== 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full sm:w-auto"
                  onClick={() => {
                    setDir('back');
                    setStep(1);
                  }}
                >
                  Change the fuel
                </Button>
              )}
            </div>
          </Notice>
        )}

        {mutation.isError && (
          <p className="text-body-sm text-[var(--color-danger-500)]">
            {mutation.error instanceof Error
              ? mutation.error.message
              : `Could not ${editing ? 'save the changes' : 'create the listing'}.`}
          </p>
        )}

        {step === 6 && (
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-[var(--color-content)]">Ready to publish</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              {/* The cover photo, at the size a renter meets it. A review that
                  says "Photos 3" is not a review of the photos; the one thing
                  worth checking here is that the first one is the good one. */}
              {photoUrls[0] && (
                <Img
                  src={photoUrls[0]}
                  alt=""
                  className="aspect-[16/9] w-full rounded-[var(--radius-control)] border border-[var(--color-line)] object-cover"
                />
              )}
              {/* What they are about to publish, in the words a renter will
                  read it in. The last chance to notice the price is wrong is
                  cheaper than the first renter noticing. */}
              <dl className="space-y-2 text-body-sm">
                <ReviewRow label="Listing" value={title.trim() || '—'} />
                <ReviewRow
                  label={machine ? 'Machine' : 'Car'}
                  value={[make.trim(), model.trim(), year].filter(Boolean).join(' ') || '—'}
                />
                <ReviewRow label="Pickup" value={[location.trim(), city].filter(Boolean).join(', ') || '—'} />
                <ReviewRow
                  label="Price"
                  value={
                    pricingMode === 'daily'
                      ? `${currency} ${Number(pricePerDay).toLocaleString()} / day`
                      : `${currency} ${Number(pricePerHour).toLocaleString()} / hour`
                  }
                />
                <ReviewRow
                  label="Renters pay"
                  value={
                    [acceptsOnline ? 'online' : null, acceptsCash ? 'cash on pickup' : null]
                      .filter(Boolean)
                      .join(' or ') || '—'
                  }
                />
                <ReviewRow label="Photos" value={`${photoUrls.length}`} />
              </dl>

              {missing.length > 0 && (
                <Notice tone="warn" className="flex-col items-stretch">
                  <p className="font-medium">Before you can publish, you still need:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </Notice>
              )}
            </CardBody>
          </Card>
        )}
        </div>

        {/* This stage's own blockers, on this stage. The whole point of the
            split: a host hears "the pickup point is missing" while looking at
            the map, not at the end next to a Publish button. */}
        {submitAttempted && step < 6 && blockersOn(step).length > 0 && (
          <Notice tone="warn" className="mt-4 flex-col items-stretch">
            <p className="font-medium">Still needed on this step:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {blockersOn(step).map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Notice>
        )}

        {/* The way out of every stage, pinned to the bottom of the screen.
            The Location stage is a map plus four fields and the Pricing stage
            is two cards; on a 320px phone Continue was a scroll away from
            whatever was just filled in, and the last field on a form is
            exactly where a host stops trusting that there is an end. Sticky,
            it is always one thumb-reach away. It sits in normal flow, so at
            the bottom of a short stage it simply is the end of the form. */}
        <div className="sticky bottom-0 z-20 mt-6 flex items-center gap-3 border-t border-[var(--color-line)] bg-[var(--color-surface)]/95 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:pb-0 sm:backdrop-blur-none">
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            onClick={() => {
              if (step === 1) navigate(editing ? `/cars/${editId}` : '/dashboard');
              else {
                setDir('back');
                setStep((v) => v - 1);
                setSubmitAttempted(false);
              }
            }}
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>

          {step < 6 ? (
            <Button
              type="button"
              // Thumb-width on a phone, shrink-wrapped once there is a mouse:
              // the only thing to the right of Back is this, so it may as well
              // be the easiest target on the screen.
              className="flex-1 sm:ml-auto sm:flex-none"
              onClick={() => {
                // Checked here rather than by disabling the button: a disabled
                // Next tells a host they cannot continue and never why. This
                // one always responds, and the answer is the list above it.
                if (blockersOn(step).length > 0) {
                  setSubmitAttempted(true);
                  return;
                }
                setDir('fwd');
                setStep((v) => v + 1);
                setSubmitAttempted(false);
              }}
            >
              Continue <ChevronRight size={16} />
            </Button>
          ) : (
            <Button
              type="submit"
              className="flex-1 sm:ml-auto sm:flex-none"
              disabled={!valid || mutation.isPending}
            >
              {mutation.isPending
                ? editing
                  ? 'Saving…'
                  : 'Publishing…'
                : editing
                  ? 'Save changes'
                  : 'Publish listing'}
            </Button>
          )}
        </div>
      </form>
      )}
        </div>
      </div>
    </section>
  );
}

/**
 * The stages, in two presentations of the same list.
 *
 * `track` is a single row that scrolls sideways and keeps the current stage
 * in view. It used to wrap, which on a 360px phone meant two rows of pills
 * and a chevron pointing at a line break — and the height of the header
 * changed as the host advanced, so the form moved under them between stages.
 *
 * `rail` is the desktop column: the same stages stacked, sticky beside the
 * form, so "where am I and what is left" is answerable without scrolling back
 * to the top.
 */
function StepNav({
  step,
  onGo,
  variant,
}: {
  step: number;
  onGo: (n: number) => void;
  variant: 'track' | 'rail';
}) {
  const ref = useRef<HTMLOListElement>(null);
  const rail = variant === 'rail';

  // Advancing past the fold would otherwise leave the current stage off the
  // right-hand end of the track, where nothing says it moved.
  useEffect(() => {
    if (rail) return;
    const here = ref.current?.querySelector('[data-here="true"]');
    here?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [step, rail]);

  return (
    <ol
      ref={ref}
      className={cn(
        rail
          ? 'mt-2 hidden space-y-0.5 lg:block'
          : 'mb-5 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden',
      )}
    >
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const here = n === step;
        return (
          <li key={label} className={cn(!rail && 'shrink-0')}>
            <button
              type="button"
              data-here={here}
              // Only backwards. Forward is earned by filling the stage in — a
              // host who jumps to Photos from stage one has skipped the
              // questions the listing cannot exist without, and would meet
              // them all again at the end, which is the pile-up this redesign
              // exists to remove.
              disabled={n > step}
              onClick={() => onGo(n)}
              className={cn(
                'flex items-center gap-2 font-medium transition-colors',
                rail
                  ? 'w-full rounded-[var(--radius-control)] px-3 py-2 text-left text-body-sm'
                  : // h-9, not the h-6 this was: a stage you cannot tap is a
                    // stage you cannot go back to.
                    'h-9 rounded-[var(--radius-pill)] px-3 text-caption whitespace-nowrap',
                here && 'bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)]',
                done && 'text-[var(--color-content)] hover:bg-[var(--color-surface-sunken)]',
                !here && !done && 'text-[var(--color-content-subtle)]',
              )}
            >
              <span
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-full',
                  rail ? 'h-5 w-5 text-[11px]' : 'h-4 w-4 text-[10px]',
                  here
                    ? 'bg-[var(--color-accent-contrast)]/25'
                    : done
                      ? 'bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)]'
                      : 'bg-[var(--color-surface-sunken)]',
                )}
              >
                {done ? <Check size={rail ? 12 : 10} /> : n}
              </span>
              <span className={cn(rail && 'min-w-0 flex-1 truncate')}>{label}</span>
              {rail && here && <ChevronRight size={14} className="shrink-0 opacity-70" />}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A make/model box that suggests from the catalogue without becoming a
 * closed list.
 *
 * It is a text input first and a picker second, and that order is the whole
 * design. The platform lists Caterpillar 320s and Grove GMK3060s next to
 * Corollas; a `<select>` of known models would have been a wall in front of
 * every host whose machine nobody has listed yet. So anything can be typed,
 * and the list is the fast path — which is also what makes it safe for the
 * page to *require* a catalogue match for cars specifically: the requirement
 * is enforced where the rule is, not by the control.
 *
 * Rows commit on `mousedown`, not `click`. A click blurs the input first, and
 * on a phone that closes the keyboard and shifts the layout out from under the
 * finger before the click resolves — so the tap lands on a different row than
 * the one that was pressed.
 */
function CatalogueCombobox({
  id,
  value,
  onChange,
  onPick,
  suggestions,
  placeholder,
  label,
  loading = false,
  invalid = false,
  verified = false,
  emptyNote,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onPick: (s: Suggestion) => void;
  suggestions: Suggestion[];
  placeholder?: string;
  /** Names the listbox for screen readers — "Makes", "Models". */
  label: string;
  loading?: boolean;
  invalid?: boolean;
  /** Shows the field has resolved to a real catalogue entry. */
  verified?: boolean;
  /**
   * What to say when the search is finished and found nothing.
   *
   * Without it the list simply closed on an empty result, which is the one
   * moment a host most needs an answer: they typed a model, the box went
   * blank, and nothing said whether it was still looking, whether the model
   * was wrong, or whether typing it was allowed. Silence reads as a broken
   * control, and it is also what makes a real car feel rejected.
   */
  emptyNote?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = `${useId()}-list`;

  useEffect(() => {
    function onDocDown(e: MouseEvent | TouchEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  // What is under the cursor changes as the list refilters, so the highlight
  // goes back to the top rather than sitting on whatever index it had.
  useEffect(() => {
    setActive(0);
  }, [value]);

  function choose(s: Suggestion) {
    onPick(s);
    setOpen(false);
  }

  // Open with nothing in it while the search is still out: closing the list
  // between keystrokes makes the box flicker and steals the tap that was
  // aimed at the row that is about to appear.
  //
  // It also stays open on a finished, empty search — see `emptyNote`. A list
  // that vanishes is the same gesture as a list that never opened, and the
  // host cannot tell "still looking" from "nothing there" from "this control
  // is broken".
  const showEmpty = open && !loading && suggestions.length === 0 && !!value.trim() && !!emptyNote;
  const showList = open && (suggestions.length > 0 || loading || showEmpty);

  return (
    <div ref={boxRef} className="relative">
      <Search
        size={15}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-content-subtle)]"
      />
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Leaving the field closes the list. Rows commit on mousedown with the
        // default prevented, so picking one never fires this first — without
        // it, tabbing from Make to Model left two overlapping dropdowns open.
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, suggestions.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && showList && suggestions[active]) {
            // Only swallow the key when it is actually picking something —
            // otherwise Enter should still submit the form.
            e.preventDefault();
            choose(suggestions[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        // A model name is not a word: autocorrect turns "GMK3060" into
        // anything it likes, and the browser's own autofill has no business
        // here when the catalogue is right there.
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="words"
        spellCheck={false}
        aria-required
        aria-invalid={invalid}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        className={cn('pl-9', (verified || loading) && 'pr-10', invalid && invalidField)}
      />
      {verified && (
        <Check
          size={16}
          aria-hidden
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-accent-on)]"
        />
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="animate-popover-in absolute z-30 mt-1 max-h-60 w-full overflow-y-auto overscroll-contain rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] py-1 shadow-[var(--shadow-float)]"
        >
          {suggestions.map((s, i) => {
            const electric = s.fuel === 'electric';
            const hybrid = s.fuel === 'hybrid';
            // Where the platform's own knowledge ends and the encyclopaedia
            // begins. Worth a line, because the rows above it fill in a body
            // category and the rows below it cannot — so a host who scrolls
            // past the divider has one more field to answer, and should be
            // able to see why.
            const opensWorld = !!s.world && !suggestions[i - 1]?.world;
            return (
              <li key={s.key}>
                {opensWorld && (
                  <p className="px-3 pb-1 pt-2 text-caption font-medium uppercase tracking-wide text-[var(--color-content-subtle)]">
                    {i === 0 ? 'Models' : 'More models'}
                  </p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(s);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    // py-2.5 rather than py-2: these are tapped with a thumb.
                    'flex w-full items-center gap-2 px-3 py-2.5 text-left text-body-sm',
                    i === active && 'bg-[var(--color-surface-sunken)]',
                  )}
                >
                  {electric ? (
                    <Zap size={15} className="shrink-0 text-[var(--color-accent-on)]" />
                  ) : (
                    <span className="w-[15px] shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[var(--color-content)]">
                    <span className="font-medium">{s.make}</span>
                    {s.model ? ` ${s.model}` : ''}
                  </span>
                  {s.fuel && (
                    <span
                      // Tokens, not `dark:` utilities. This file has no
                      // `@custom-variant dark`, so Tailwind's `dark:` is the
                      // OS media query while the app's theme is an attribute —
                      // the two disagree for anyone running a light page on a
                      // dark desktop, and the badge came out dark-green-on-
                      // white with the label barely legible. `accent-on`
                      // promotes itself per theme and needs no second rule.
                      className={cn(
                        'shrink-0 rounded-[var(--radius-pill)] px-2 py-0.5 text-caption font-medium',
                        'bg-[var(--color-surface-sunken)]',
                        electric || hybrid
                          ? 'text-[var(--color-accent-on)]'
                          : 'text-[var(--color-content-muted)]',
                      )}
                    >
                      {FUEL_LABEL[s.fuel]}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {showEmpty && (
            <li className="px-3 py-2.5 text-body-sm text-[var(--color-content-muted)]">
              {emptyNote}
            </li>
          )}
          {loading && (
            // The world search is debounced and goes over the network, so the
            // list can sit on local matches for a beat. Without this the box
            // looks like it has finished answering when it has not started.
            <li
              aria-hidden
              className="px-3 py-2 text-caption text-[var(--color-content-subtle)]"
            >
              Searching…
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Loaded-layout stand-in for fetching the existing listing in edit mode —
 * the same five Card groups (car, location, pricing, availability, photos)
 * with a label-height line + `h-11` field block per input, so the form
 * doesn't reflow once the listing's values fill it in.
 */
function ListCarSkeleton() {
  return (
    <div className="mt-6 space-y-6" aria-busy="true" aria-label="Loading">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardBody className="space-y-4">
          <div>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-1.5 h-11 w-full" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Skeleton className="h-4 w-16" />
              <Skeleton className="mt-1.5 h-11 w-full" />
            </div>
            <div>
              <Skeleton className="h-4 w-16" />
              <Skeleton className="mt-1.5 h-11 w-full" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Skeleton className="h-4 w-16" />
              <Skeleton className="mt-1.5 h-11 w-full" />
            </div>
            <div>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-1.5 h-11 w-full" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Skeleton className="h-4 w-14" />
              <Skeleton className="mt-1.5 h-11 w-full" />
            </div>
            <div>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-1.5 h-11 w-full" />
            </div>
            <div>
              <Skeleton className="h-4 w-14" />
              <Skeleton className="mt-1.5 h-11 w-full" />
            </div>
          </div>
          <div>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="mt-1.5 h-20 w-full" />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-20" />
        </CardHeader>
        <CardBody className="space-y-4">
          <div>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="mt-1.5 h-10 w-full" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Skeleton className="h-4 w-10" />
              <Skeleton className="mt-1.5 h-11 w-full" />
            </div>
            <div>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-1.5 h-11 w-full" />
            </div>
          </div>
          <div>
            <Skeleton className="h-4 w-52" />
            <Skeleton className="mt-1.5 h-56 w-full" />
          </div>
          <div>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-1.5 h-11 w-full" />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-16" />
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-1.5 h-11 w-full" />
            </div>
            <div>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-1.5 h-11 w-full" />
            </div>
          </div>
          <div>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="mt-1.5 h-11 w-full" />
          </div>
          <div>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-1.5 h-11 w-full" />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardBody className="space-y-3">
          <div>
            <Skeleton className="h-4 w-14" />
            <Skeleton className="mt-1.5 h-11 w-full" />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-16" />
        </CardHeader>
        <CardBody className="space-y-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full max-w-xs" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-16 w-24" />
            <Skeleton className="h-16 w-24" />
            <Skeleton className="h-16 w-24" />
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end gap-3">
        <Skeleton className="h-11 w-24" />
        <Skeleton className="h-11 w-32" />
      </div>
    </div>
  );
}
