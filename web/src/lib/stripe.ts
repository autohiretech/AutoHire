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

export const isStripeConfigured = Boolean(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
