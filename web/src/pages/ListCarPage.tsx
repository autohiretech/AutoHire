import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Zap } from 'lucide-react';
import type { CarCategory, FuelType, Transmission } from '@autohire/shared';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import type { CreateListingInput } from '@/lib/types';
import { Button, Card, CardBody, CardHeader, Input, Label, Select, Spinner } from '@/components/ui';
import { Img } from '@/components/Img';
import { ModelCombobox } from '@/components/ModelCombobox';
import { LocationPicker, type LatLng } from '@/components/map/LocationPicker';
import { isLikelyUrl, normalizeUrl } from '@/lib/location';
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
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft size={16} /> Back to dashboard
      </Link>

      <h1 className="text-2xl font-bold text-ink-900">
        {editing ? 'Edit your listing' : 'List your vehicle or machine'}
      </h1>
      <p className="mt-1 text-sm text-ink-500">
        {editing
          ? 'Update the details, photos, location and availability.'
          : 'Rent out a car, a tractor or an excavator. Your first listing turns your account into a host.'}
      </p>

      {editing && existingQuery.isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size={28} />
        </div>
      ) : (
      <form onSubmit={onSubmit} className="mt-6 space-y-6">
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-ink-900">{machine ? 'The machine' : 'The car'}</h2>
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
                <p className="mt-1 flex items-center gap-1 text-xs text-ink-400">
                  <Zap size={12} className="text-brand-600" /> Pick a model to fill in make, model
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
              <p className="mt-1 text-xs text-ink-400">Separate with commas.</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-ink-900">Location</h2>
            <p className="mt-0.5 text-sm text-ink-500">Where renters pick it up.</p>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <Label>Country</Label>
              {accountCountry ? (
                <>
                  <div className="flex h-10 items-center rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm text-ink-700">
                    {selectedCountry?.flag} {selectedCountry?.name ?? accountCountry}
                  </div>
                  <p className="mt-1 text-xs text-ink-400">
                    Where the car is located. This follows your account's country — change it on
                    the{' '}
                    <Link to="/account" className="text-brand-600 hover:underline">
                      Account
                    </Link>{' '}
                    page, not per listing. The price currency below can still differ — useful if
                    you mostly book foreign renters.
                  </p>
                </>
              ) : (
                <p className="rounded-lg border border-accent-200 bg-accent-50 px-3 py-2.5 text-sm text-accent-800">
                  Set your country on the{' '}
                  <Link to="/account" className="font-medium underline">
                    Account
                  </Link>{' '}
                  page before listing a car — that's where it'll be listed.
                </p>
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
              <Label>Pickup point on the map</Label>
              <LocationPicker
                value={coords}
                onChange={setCoords}
                onAddress={(address) => {
                  // Fill the pickup-area text from the search if it's still empty.
                  if (!location.trim()) setLocation(address.split(',').slice(0, 2).join(',').trim());
                }}
              />
            </div>
            <div>
              <Label htmlFor="location-url">Location link (optional)</Label>
              <Input
                id="location-url"
                value={locationUrl}
                onChange={(e) => setLocationUrl(e.target.value)}
                placeholder="https://maps.google.com/…  or a directions/instructions link"
              />
              <p className="mt-1 text-xs text-ink-400">
                A Google Maps share link, What3Words, or any page with arrival instructions.
                Renters can open it when heading to pickup.
              </p>
              {locationUrl.trim() && !isLikelyUrl(locationUrl) && (
                <p className="mt-1 text-sm text-red-600">That doesn't look like a valid link.</p>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-ink-900">Pricing</h2>
            <p className="mt-0.5 text-sm text-ink-500">
              Choose how this {machine ? 'machine' : 'car'} is booked — by the day, or by the hour.
            </p>
          </CardHeader>
          <CardBody className="space-y-5">
            <div>
              <Label>Booking type</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPricingMode('daily')}
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-2 text-sm font-medium',
                    pricingMode === 'daily'
                      ? 'border-ink-900 bg-ink-900 text-white'
                      : 'border-ink-200 text-ink-700',
                  )}
                >
                  Per day
                </button>
                <button
                  type="button"
                  onClick={() => setPricingMode('hourly')}
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-2 text-sm font-medium',
                    pricingMode === 'hourly'
                      ? 'border-ink-900 bg-ink-900 text-white'
                      : 'border-ink-200 text-ink-700',
                  )}
                >
                  Per hour
                </button>
              </div>
              <p className="mt-1.5 text-xs text-ink-400">
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
              <div className="border-t border-ink-100 pt-5">
                <Label htmlFor="overage-multiplier">Late-return rate</Label>
                <p className="mb-1.5 text-xs text-ink-500">
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
                  <span className="text-sm text-ink-500">× hourly price</span>
                </div>
                <p className="mt-1.5 text-xs text-ink-400">
                  {Number(pricePerHour) > 0 && Number(overageMultiplier) > 0
                    ? `Currently ${Math.round(Number(pricePerHour) * Number(overageMultiplier)).toLocaleString()} ${currency} per extra hour, after the grace period.`
                    : ''}{' '}
                  Shown to you on the trip so you can follow up — never charged automatically.
                </p>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-ink-900">Availability</h2>
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
            <p className="text-xs text-ink-400">
              {status === 'maintenance'
                ? 'Renters can only book trips that start on or after this date.'
                : 'The car is bookable on any free date. Booked dates fill in automatically.'}
            </p>
            {!statusValid && (
              <p className="text-sm text-red-600">Pick a back-in-service date (today or later).</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-ink-900">Photos</h2>
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
              className="block w-full text-sm text-ink-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100 disabled:opacity-60"
            />
            <p className="text-xs text-ink-400">
              JPG or PNG, up to a few photos. You can add more in several goes.
            </p>
            {uploading && <p className="text-xs text-ink-500">Uploading…</p>}
            {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
            {photoUrls.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {photoUrls.map((url) => (
                  <div key={url} className="relative">
                    <Img
                      src={url}
                      alt=""
                      className="h-16 w-24 rounded-lg border border-ink-100 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setPhotoUrls((prev) => prev.filter((u) => u !== url))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink-900/80 text-xs text-white hover:bg-ink-900"
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
          <div className="flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
            <Zap size={18} className="mt-0.5 shrink-0 text-brand-600" />
            <div className="text-sm">
              <p className="font-semibold text-brand-800">Only electric cars can be listed right now</p>
              <p className="mt-0.5 text-brand-700">
                AutoHire keeps at least {quota.minPercent}% of its cars electric. The fleet is at{' '}
                {quota.totalCars > 0
                  ? Math.round((quota.electricCars / quota.totalCars) * 100)
                  : 0}
                % ({quota.electricCars}/{quota.totalCars}), so a {fuel} car can’t be added yet.
                Choose an electric model above, or set the fuel to Electric.
              </p>
            </div>
          </div>
        )}

        {mutation.isError && (
          <p className="text-sm text-red-600">
            {mutation.error instanceof Error
              ? mutation.error.message
              : `Could not ${editing ? 'save the changes' : 'create the listing'}.`}
          </p>
        )}

        {submitAttempted && missing.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-800">
            <p className="font-medium">Before you can publish, you still need:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
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
