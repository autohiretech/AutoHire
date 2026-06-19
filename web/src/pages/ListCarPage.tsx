import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { CarCategory, FuelType, Transmission } from '@autohire/shared';
import { client } from '@/lib/client';
import type { CreateListingInput } from '@/lib/types';
import { Button, Card, CardBody, CardHeader, Input, Label, Select } from '@/components/ui';
import { LocationPicker, type LatLng } from '@/components/map/LocationPicker';
import { isLikelyUrl, normalizeUrl } from '@/lib/location';

const CITIES = ['Kigali', 'Musanze', 'Rubavu', 'Huye', 'Rusizi'];

const CATEGORIES: { value: CarCategory; label: string }[] = [
  { value: 'sedan', label: 'Sedan' },
  { value: 'suv', label: 'SUV' },
  { value: '4x4', label: '4x4' },
  { value: 'hatchback', label: 'Hatchback' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'van', label: 'Van' },
  { value: 'minibus', label: 'Minibus' },
  { value: 'luxury', label: 'Luxury' },
];

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

  const [title, setTitle] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('2020');
  const [category, setCategory] = useState<CarCategory>('suv');
  const [seats, setSeats] = useState('5');
  const [transmission, setTransmission] = useState<Transmission>('automatic');
  const [fuel, setFuel] = useState<FuelType>('petrol');
  const [pricePerDay, setPricePerDay] = useState('40000');
  const [city, setCity] = useState('Kigali');
  const [location, setLocation] = useState('');
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [locationUrl, setLocationUrl] = useState('');
  const [bookingMode, setBookingMode] = useState<'instant' | 'request'>('instant');
  const [status, setStatus] = useState<'available' | 'maintenance'>('available');
  const [maintenanceUntil, setMaintenanceUntil] = useState('');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [features, setFeatures] = useState('');

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

  const today = new Date().toISOString().slice(0, 10);
  // In maintenance requires a valid back-in-service date (today or later).
  const statusValid = status === 'available' || (!!maintenanceUntil && maintenanceUntil >= today);

  const mutation = useMutation({
    mutationFn: (input: CreateListingInput) => client.createListing(input),
    onSuccess: (listing) => {
      queryClient.invalidateQueries({ queryKey: ['ownerListings'] });
      queryClient.invalidateQueries({ queryKey: ['ownerHost'] });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      navigate(`/cars/${listing.id}`);
    },
  });

  const valid =
    title.trim() &&
    make.trim() &&
    model.trim() &&
    location.trim() &&
    Number(year) > 1980 &&
    Number(seats) > 0 &&
    Number(pricePerDay) > 0 &&
    photoUrls.length > 0 &&
    !uploading &&
    statusValid &&
    (!locationUrl.trim() || isLikelyUrl(locationUrl));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    mutation.mutate({
      title: title.trim(),
      category,
      make: make.trim(),
      model: model.trim(),
      year: Number(year),
      seats: Number(seats),
      transmission,
      fuel,
      pricePerDayRwf: Number(pricePerDay),
      location: location.trim(),
      city,
      photos: photoUrls,
      features: toList(features),
      bookingMode,
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

      <h1 className="text-2xl font-bold text-ink-900">List your car</h1>
      <p className="mt-1 text-sm text-ink-500">
        Add a vehicle to rent out. Your first listing turns your account into a host.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-6">
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-ink-900">The car</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <Label htmlFor="title">Listing title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Toyota RAV4 — great for Kigali & trips"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="make">Make</Label>
                <Input id="make" value={make} onChange={(e) => setMake(e.target.value)} placeholder="Toyota" />
              </div>
              <div>
                <Label htmlFor="model">Model</Label>
                <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="RAV4" />
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
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="seats">Seats</Label>
                <Input id="seats" type="number" value={seats} onChange={(e) => setSeats(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="transmission">Transmission</Label>
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
                <Label htmlFor="fuel">Fuel</Label>
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
            <h2 className="font-semibold text-ink-900">Location & pricing</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="city">City</Label>
                <Select id="city" value={city} onChange={(e) => setCity(e.target.value)}>
                  {CITIES.map((c) => (
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="price">Price per day (RWF)</Label>
                <Input
                  id="price"
                  type="number"
                  value={pricePerDay}
                  onChange={(e) => setPricePerDay(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="mode">Booking mode</Label>
                <Select
                  id="mode"
                  value={bookingMode}
                  onChange={(e) => setBookingMode(e.target.value as 'instant' | 'request')}
                >
                  <option value="instant">Instant book — confirm automatically</option>
                  <option value="request">Request to book — you approve</option>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="status">Availability</Label>
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
                    <img
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

        {mutation.isError && (
          <p className="text-sm text-red-600">
            {mutation.error instanceof Error ? mutation.error.message : 'Could not create the listing.'}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => navigate('/dashboard')}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || mutation.isPending}>
            {mutation.isPending ? 'Publishing…' : 'Publish listing'}
          </Button>
        </div>
      </form>
    </section>
  );
}
