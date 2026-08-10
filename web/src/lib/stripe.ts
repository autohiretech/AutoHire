import { loadStripe, type Stripe } from '@stripe/stripe-js';

/**
 * Lazily-loaded Stripe.js, keyed by the publishable key. Returns null when no
 * key is configured so the UI can show a "payments not set up" state instead of
 * crashing.
 */
let promise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> | null {
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
  if (!key) return null;
  if (!promise) promise = loadStripe(key);
  return promise;
}

/**
 * Stripe.js for a key we were handed rather than one we were built with.
 *
 * Under PayHold the publishable key belongs to *its* Stripe account, not to a
 * `VITE_` value of ours, and it arrives per deal on the checkout session. So
 * the key is an argument here, and the cache is per key: `loadStripe` mounts a
 * global singleton bound to whichever key called it first, and reusing that
 * instance for a second account would confirm a payment against the wrong one.
 */
const byKey = new Map<string, Promise<Stripe | null>>();

export function getStripeFor(key: string): Promise<Stripe | null> {
  const existing = byKey.get(key);
  if (existing) return existing;
  const loading = loadStripe(key);
  byKey.set(key, loading);
  return loading;
}

export const isStripeConfigured = Boolean(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
