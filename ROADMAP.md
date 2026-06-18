# AutoHire — Build Roadmap

Peer-to-peer + fleet car rental marketplace for Rwanda. See the Rwanda Market
Adaptation addendum (June 2026) for product rationale. This file is the staged
build plan and the single source of truth for "what stage are we on?".

## Stage scheme at a glance

- **Stage A — Hardcoded frontend.** Every screen reads through `web/src/mocks/client.ts`
  (`mockClient`). No backend, no network. Goal: the *entire* product is clickable and
  demo-able on mock data. Parts A0–A9.
- **Stage B — Backend & real data.** Stand up an API + database + auth, then add a real HTTP
  client with identical method signatures. A runtime flag (`VITE_USE_MOCK`) chooses between the
  mock and the real client. **The hardcoded mock layer is kept, not deleted** — it stays as an
  offline/demo/dev mode for as long as you want. Going database-only is a deliberate, opt-in step
  you take when *you* decide (Stage B step 7), not a side effect of adding the backend.
- **Stage C — Integrations.** Payments (split rails), SMS, OCR, insurance partners.
- **Stage D — Hardening & launch.** Tests, security, performance, deploy, mobile.

> Rule for Stage A: never call a real network. Add every new data need as a method on
> `mockClient` first. When Stage B lands, only that one module changes.

---

## Languages & stack

**Decided / in use (Stage A):**
- **TypeScript** everywhere — one language across web, shared types, and the future API.
- **React 18 + Vite 6** — web app (`web/`).
- **Tailwind CSS v4** — styling (already wired via `@tailwindcss/vite`).
- **React Router v7** — routing.
- **TanStack Query v5** — data fetching/caching (wraps `mockClient` now, real client later).
- **`@autohire/shared`** — domain types shared by web now and the API later. Keep all
  data shapes here so the stack stays in sync.

**Decided for Stage B:**
- **Database & backend platform: Supabase** (managed PostgreSQL + Auth + Storage + auto REST/
  Realtime). This is the source of truth once we cut over.
- **Auth: Supabase Auth** — email/OTP + phone (Rwandan MSISDN); RLS policies for renter/owner/admin.
- **Storage: Supabase Storage** — verification doc uploads and car photos.
- **Data access:** the real `client` talks to Supabase via `@supabase/supabase-js` (with Row-Level
  Security), wrapped behind the same `Client` interface as `mockClient`. A thin server (Hono in
  `packages/api`) is added only where logic must not live in the client — notably the payment
  split and payouts.

**Recommended but not yet locked:**
- **Schema tooling:** Supabase migrations (SQL) or Drizzle/Prisma against the Supabase Postgres
  connection string — pick when modeling the DB.
- **Payments:** Stripe (collection) + MTN MoMo / Airtel Money / bank transfer (payout),
  split owned by our backend — NOT Stripe Connect end-to-end (it can't pay out to RW).
- **SMS:** treat as a primary channel (Africa's Talking or similar), alongside push.
- **OCR:** license/ID + vehicle docs (cloud OCR provider).

---

## Stage A — Hardcoded frontend (current focus)

Each part below is shippable on its own and ends with a clickable screen on mock data.

### A0 — Scaffold ✅ (done)
Monorepo (npm workspaces), Vite + React + TS, Tailwind, router, UI kit
(`web/src/components/ui`), layout, `@autohire/shared` domain types, Rwanda mock data,
and `mockClient`. Routes: `/`, `/dashboard`, `/trips`.

**Steps per remaining part:** (1) add any needed `mockClient` methods, (2) build the
page + components, (3) wire with TanStack Query, (4) add the route in `App.tsx`, (5) link
it from nav, (6) verify loading/empty/error states render.

### A1 — Search & browse
Home: listing grid of `ListingCard`s, search bar, filters (city, category, owner type,
price, transmission, seats). Uses `mockClient.listListings(filters)` (already exists).
Empty + loading states.

### A2 — Car detail page
`/cars/:id`: photo gallery, specs, host profile card (individual vs. business badge),
reviews list, availability (blocked dates), price summary, "Request/Instant book" CTA.
Uses `getListing`, `getHost`, `listReviews`.

### A3 — Booking & trip flow ("My trips")
Booking request → mock payment screen → confirmation. `/trips` list grouped by state
(requested/confirmed/active/completed). Trip timeline with photo check-in/check-out UI.
Uses `listBookings`, `getBooking`; add `createBooking` to `mockClient`.

### A4 — Owner / host dashboard
`/dashboard`: my listings, availability calendar (block personal-use dates), pricing
controls, incoming booking-request queue (approve/decline), payout history (MoMo/Airtel/
bank channels). Add owner-scoped methods to `mockClient`.

### A5 — Messaging
`/messages`: conversation list + chat thread between renter and host. Uses
`listConversations`, `listMessages`; add `sendMessage` to `mockClient`.

### A6 — Verification
Renter: driver's license + ID upload UI (OCR placeholder). Owner: vehicle docs + proof of
insurance upload. Status states (pending/verified/rejected). Add verification methods.

### A7 — Reviews & ratings
Two-way review forms + display (renter↔host). Uses `listReviews`; add `createReview`.

### A8 — Notifications
`/notifications`: in-app list with channel badges (SMS / push / in-app). Uses
`listNotifications`; add mark-as-read.

### A9 — Admin panel
`/admin`: moderation queue (flagged listings/users), dispute-resolution workflow for
damage claims, payout/revenue reporting. Add admin-scoped mock methods.

**Stage A exit criteria:** all flows in the blueprint's "Full app scope" (Section 4) are
clickable on mock data; no real network calls anywhere.

---

## Stage B — Backend & real data

> **Mock-data policy:** the hardcoded layer is a feature, not scaffolding to throw away.
> It stays selectable for as long as you want, so you can always *see* the full app with no
> backend running. The database becomes the source of truth only when you flip the switch in
> step 7 — and even then the mock can remain behind the flag for offline/demo/dev use.

1. **Add the client seam first.** Define a `Client` interface (the shape of today's `mockClient`)
   and have the app import a single `client` chosen at startup by `VITE_USE_MOCK`
   (defaults to mock). No behavior changes yet — this just makes the rest of Stage B a flip.
2. **Create the Supabase project**; model the schema from `@autohire/shared` types (tables for
   listings, hosts, bookings, payouts, conversations, messages, reviews, verification docs,
   flags, disputes) with Row-Level Security policies.
3. **Seed Supabase from `web/src/mocks/data.ts`** so a fresh DB starts with the same Kigali
   cars/hosts/bookings you already see. (The mock data migrates; it isn't lost.)
4. **Supabase Auth** (email/OTP + phone), roles (renter/owner/admin). Replace the hardcoded
   `currentUser` / `CURRENT_HOST_ID` with the logged-in session; the renter/host mode switch stays.
5. Build the real client (`supabaseClient`) using `@supabase/supabase-js`, implementing every
   `mockClient` method behind the shared `Client` interface. Move file uploads to Supabase Storage.
6. Add a thin `packages/api` (Hono) only for logic that must not run in the browser — the
   payment split and host payouts (Stage C wires the actual rails).
7. **Opt-in cutover (your call).** Set `VITE_USE_MOCK=false` to run on Supabase. Keep the mock
   behind the flag indefinitely, or delete it later once you no longer want the offline mode —
   entirely your decision.
8. `owner_type` drives verification + payout logic; business vs. individual host accounts.

## Stage C — Integrations
Stripe collection; MoMo/Airtel/bank payout with platform-owned split; SMS (primary
channel); OCR for verification; insurance handling differentiated by host type.

## Stage D — Hardening & launch
Tests, security review, performance, observability, deploy. Mobile/responsive pass.
(Autonomous-driving features are explicitly deprioritized — not in near-term scope.)
