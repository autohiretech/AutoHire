# AutoHire — Build Roadmap

Peer-to-peer + fleet car rental marketplace for Rwanda. See the Rwanda Market
Adaptation addendum (June 2026) for product rationale. This file is the staged
build plan and the single source of truth for "what stage are we on?".

## Stage scheme at a glance

- **Stage A — Hardcoded frontend.** Every screen reads through `web/src/mocks/client.ts`
  (`mockClient`). No backend, no network. Goal: the *entire* product is clickable and
  demo-able on mock data. Parts A0–A9.
- **Stage B — Backend & real data.** Stand up an API + database + auth, then swap
  `mockClient` for a real HTTP client with identical method signatures. Screens don't change.
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

**Recommended for later stages (confirm before Stage B):**
- **Backend:** TypeScript — Hono (lightweight) or NestJS (batteries-included). Staying in TS
  reuses `@autohire/shared` types end-to-end and keeps one language.
- **Database:** PostgreSQL + Prisma (typed schema, migrations).
- **Auth:** email/OTP + phone (Rwandan MSISDN); JWT or session.
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
1. Choose & scaffold API (see stack recommendation) in `packages/api`.
2. Model the database from `@autohire/shared` types; migrations.
3. Auth (email/OTP + phone), roles (renter/owner/admin).
4. Implement endpoints mirroring every `mockClient` method.
5. Build a real HTTP client with identical signatures; swap it in for `mockClient`.
6. `owner_type` drives verification + payout logic; business vs. individual host accounts.

## Stage C — Integrations
Stripe collection; MoMo/Airtel/bank payout with platform-owned split; SMS (primary
channel); OCR for verification; insurance handling differentiated by host type.

## Stage D — Hardening & launch
Tests, security review, performance, observability, deploy. Mobile/responsive pass.
(Autonomous-driving features are explicitly deprioritized — not in near-term scope.)
