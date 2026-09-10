import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Zap } from 'lucide-react';
import type { CarCategory, FuelType, Transmission } from '@autohire/shared';
import { client } from '@/lib/client';
import type { CreateListingInput } from '@/lib/types';
import { Button, Card, CardBody, CardHeader, Chip, Input, Label, Notice, Select, Skeleton, toast } from '@/components/ui';
import { Img } from '@/components/Img';
import { ModelCombobox } from '@/components/ModelCombobox';
import { LocationPicker, type LatLng } from '@/components/map/LocationPicker';
import { extractLatLngFromMapsUrl, isGoogleMapsLink, isLikelyUrl, isShortMapsLink, normalizeUrl } from '@/lib/location';
import { useCountry } from '@/lib/country';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { citiesFor } from '@/lib/cities';
import { CAR_CATEGORIES, CATEGORY_GROUPS, isMachine } from '@/lib/categories';
import { CURRENCIES, type CurrencyCode } from '@/lib/currency';

const FUELS: { value: FuelType; label: string }[] = [
  { value: 'petrol', label: 'Petrol' },
  { value: 'diesel', label: 'Diesel' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'electric', label: 'Electric' },
];

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
export function ListCarPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id: editId } = useParams();
  const editing = !!editId;

  // A car is registered in the host's account country — set on the Account
  // page, not chosen per-listing. That's the one thing that stops a host's
  // fleet from spreading across markets they don't actually operate in.
  const { countries } = useCountry();
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
  // Only nag about what's missing after the host actually tries to submit —
  // showing a checklist of everything blank the moment the page loads would
  // just be noise on an empty form.
  const [submitAttempted, setSubmitAttempted] = useState(false);

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
  }, [existing]);

  // Country still drives the city list and the default currency (RW→RWF,
  // AE→AED, CN→CNY, US→USD) — a car still can't end up in a market the host
  // doesn't operate in. Currency itself is now a field: a host taking foreign
  // bookings (e.g. a UAE host pricing in USD for tourists) can override the
  // suggestion, same pattern as the hourly rate below.
  const selectedCountry = countries.find((c) => c.code === accountCountry);
  const suggestedCurrency = selectedCountry?.currency ?? 'RWF';
  const currency = priceCurrencyTouched ? priceCurrency : suggestedCurrency;
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

  // Platform electric quota: a non-electric CAR can only be listed while the
  // fleet stays at/above the threshold. Machinery + electric cars are exempt.
  const { data: quota } = useQuery({
    queryKey: ['electricQuota'],
    queryFn: () => client.getElectricQuota(),
  });
  const blockedNonElectric =
    !machine && fuel !== 'electric' && !!quota && !quota.canAddNonElectric;

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

  // What's stopping Publish, in plain language — shown near the button rather
  // than leaving a host to guess why it's greyed out.
  const missing: string[] = [];
  if (!accountCountry) missing.push('your account country (set it on the Account page)');
  if (!title.trim()) missing.push('a listing title');
  if (!make.trim()) missing.push('the make');
  if (!model.trim()) missing.push('the model');
  if (!(Number(year) > 1980)) missing.push('a valid year');
  if (!(Number(seats) > 0)) missing.push(machine ? 'cab seats' : 'seats');
  if (!location.trim()) missing.push('the pickup area');
  // The text field alone isn't enough to plot on the map — without real
  // coordinates a listing simply never gets a pin (ResultsMap only plots
  // listings that have lat/lng), so a renter searching the map never finds
  // it even though it exists. The map picker (search, click, or drag) is
  // how a host actually sets this; the Google Maps link field stays
  // optional, since it duplicates the same coordinate once entered.
  if (!coords) missing.push('an exact pickup point on the map');
  if (pricingMode === 'daily' && !(Number(pricePerDay) > 0)) missing.push('a price per day');
  if (pricingMode === 'hourly' && !(Number(pricePerHour) > 0)) missing.push('a price per hour');
  if (pricingMode === 'daily' && !(Number(overageMultiplier) > 0)) missing.push('a late-return rate');
  if (locationUrl.trim() && !isLikelyUrl(locationUrl)) missing.push('a valid location link');
  if (!statusValid) missing.push('a back-in-service date');
  if (blockedNonElectric) missing.push('an electric vehicle — the fleet quota is full for other fuel types');
  if (photoUrls.length === 0) missing.push('at least one photo');
  if (uploading) missing.push('the photo upload to finish');

  const valid = missing.length === 0;

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
    });
  }

  return (
    <section className="mx-auto max-w-3xl px-4 py-8">
      <Link
        to="/dashboard"
        className="mb-4 inline-flex items-center gap-1.5 text-body-sm text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
      >
        <ArrowLeft size={16} /> Back to dashboard
      </Link>

      <h1 className="text-h2 text-[var(--color-content)]">
        {editing ? 'Edit your listing' : 'List your vehicle or machine'}
      </h1>
      <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">
        {editing
          ? 'Update the details, photos, location and availability.'
          : 'Rent out a car, a tractor or an excavator. Your first listing turns your account into a host.'}
      </p>

      {editing && existingQuery.isLoading ? (
        <ListCarSkeleton />
      ) : (
      <form onSubmit={onSubmit} className="mt-6 space-y-6">
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-[var(--color-content)]">{machine ? 'The machine' : 'The car'}</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <Label htmlFor="title">Listing title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  machine
                    ? 'Kubota T1400 — tiller for hire near Kigali'
                    : 'Toyota RAV4 — great for Kigali & trips'
                }
              />
            </div>
            {!machine && (
              <div>
                <Label>Find your model</Label>
                <ModelCombobox
                  onSelect={(m) => {
                    setMake(m.make);
                    setModel(m.model);
                    setFuel(m.fuel);
                    setCategory(m.category);
                  }}
                />
                <p className="mt-1 flex items-center gap-1 text-caption text-[var(--color-content-subtle)]">
                  <Zap size={12} className="text-[var(--color-accent-on)]" /> Pick a model to fill in make, model
                  and fuel — electric cars are badged. Or type them in below.
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="make">Make</Label>
                <Input
                  id="make"
                  value={make}
                  onChange={(e) => setMake(e.target.value)}
                  placeholder={machine ? 'Kubota' : 'Toyota'}
                />
              </div>
              <div>
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={machine ? 'T1400' : 'RAV4'}
                />
              </div>
              <div>
                <Label htmlFor="year">Year</Label>
                <Input id="year" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <div>
                <Label htmlFor="category">Category</Label>
                <Select id="category" value={category} onChange={(e) => setCategory(e.target.value as CarCategory)}>
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
              <div>
                <Label htmlFor="seats">{machine ? 'Cab seats' : 'Seats'}</Label>
                <Input id="seats" type="number" value={seats} onChange={(e) => setSeats(e.target.value)} />
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
                <Select id="fuel" value={fuel} onChange={(e) => setFuel(e.target.value as FuelType)}>
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
                  <p className="mt-1 text-caption text-[var(--color-content-subtle)]">
                    Where the car is located. This follows your account's country — change it on
                    the{' '}
                    <Link to="/account" className="text-[var(--color-accent-on)] hover:underline">
                      Account
                    </Link>{' '}
                    page, not per listing. The price currency below can still differ — useful if
                    you mostly book foreign renters.
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
                <Label htmlFor="location">Pickup area</Label>
                <Input
                  id="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Kimihurura, Kigali"
                />
              </div>
            </div>
            <div>
              <Label>Pickup point on the map (required)</Label>
              <LocationPicker
                value={coords}
                onChange={setCoords}
                onAddress={(address) => {
                  // Fill the pickup-area text from the search if it's still empty.
                  if (!location.trim()) setLocation(address.split(',').slice(0, 2).join(',').trim());
                }}
              />
              <p className="mt-1 text-caption text-[var(--color-content-subtle)]">
                Search, click, or drag to drop the exact pin — this is what puts the car on
                renters' maps. The link below is just a convenience for arrival instructions, not
                a substitute for this.
              </p>
            </div>
            <div>
              <Label htmlFor="location-url">Location link (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="location-url"
                  value={locationUrl}
                  onChange={(e) => setLocationUrl(e.target.value)}
                  placeholder="https://maps.google.com/…  or a directions/instructions link"
                  className="flex-1"
                />
                {isGoogleMapsLink(normalizeUrl(locationUrl)) && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void setPinFromLocationUrl()}
                    disabled={resolvingLink}
                  >
                    {resolvingLink ? '…' : 'Set pin from link'}
                  </Button>
                )}
              </div>
              <p className="mt-1 text-caption text-[var(--color-content-subtle)]">
                A Google Maps share link, What3Words, or any page with arrival instructions.
                Renters can open it when heading to pickup — and a Google Maps link can set the
                pickup pin above directly, long or shortened.
              </p>
              {locationUrl.trim() && !isLikelyUrl(locationUrl) && (
                <p className="mt-1 text-body-sm text-[var(--color-danger-500)]">That doesn't look like a valid link.</p>
              )}
            </div>
          </CardBody>
        </Card>

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
              <div className="flex gap-2">
                <Chip
                  selected={pricingMode === 'daily'}
                  onClick={() => setPricingMode('daily')}
                  className="flex-1 justify-center"
                >
                  Per day
                </Chip>
                <Chip
                  selected={pricingMode === 'hourly'}
                  onClick={() => setPricingMode('hourly')}
                  className="flex-1 justify-center"
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                <Select
                  id="price-currency"
                  value={currency}
                  onChange={(e) => {
                    setPriceCurrency(e.target.value as CurrencyCode);
                    setPriceCurrencyTouched(true);
                  }}
                >
                  {Object.keys(CURRENCIES).map((code) => (
                    <option key={code} value={code}>
                      {code}
                      {code === suggestedCurrency ? ' (your market)' : ''}
                    </option>
                  ))}
                </Select>
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

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-[var(--color-content)]">Availability</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-[var(--color-content)]">Photos</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            <Label htmlFor="photos">Upload photos</Label>
            <input
              id="photos"
              type="file"
              accept="image/*"
              multiple
              disabled={uploading}
              onChange={onPickPhotos}
              className="block w-full text-body-sm text-[var(--color-content-muted)] file:mr-3 file:rounded-[var(--radius-control)] file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-body-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100 disabled:opacity-60"
            />
            <p className="text-caption text-[var(--color-content-subtle)]">
              JPG or PNG, up to a few photos. You can add more in several goes.
            </p>
            {uploading && <p className="text-caption text-[var(--color-content-muted)]">Uploading…</p>}
            {uploadError && <p className="text-body-sm text-[var(--color-danger-500)]">{uploadError}</p>}
            {photoUrls.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {photoUrls.map((url) => (
                  <div key={url} className="relative">
                    <Img
                      src={url}
                      alt=""
                      className="h-16 w-24 rounded-[var(--radius-control)] border border-[var(--color-line)] object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setPhotoUrls((prev) => prev.filter((u) => u !== url))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-surface-inverse)]/80 text-caption text-[var(--color-content-inverse)] hover:bg-[var(--color-surface-inverse)]"
                      aria-label="Remove photo"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {blockedNonElectric && quota && (
          <Notice tone="brand">
            <Zap size={18} className="mt-0.5 shrink-0" />
            <div className="text-body-sm">
              <p className="font-semibold">Only electric cars can be listed right now</p>
              <p className="mt-0.5">
                AutoHire keeps at least {quota.minPercent}% of its cars electric. The fleet is at{' '}
                {quota.totalCars > 0
                  ? Math.round((quota.electricCars / quota.totalCars) * 100)
                  : 0}
                % ({quota.electricCars}/{quota.totalCars}), so a {fuel} car can’t be added yet.
                Choose an electric model above, or set the fuel to Electric.
              </p>
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

        {submitAttempted && missing.length > 0 && (
          <Notice tone="warn" className="flex-col items-stretch">
            <p className="font-medium">Before you can publish, you still need:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Notice>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => navigate(editing ? `/cars/${editId}` : '/dashboard')}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || mutation.isPending}>
            {mutation.isPending
              ? editing
                ? 'Saving…'
                : 'Publishing…'
              : editing
                ? 'Save changes'
                : 'Publish listing'}
          </Button>
        </div>
      </form>
      )}
    </section>
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
