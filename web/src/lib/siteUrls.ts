/**
 * Where each AutoHire site lives.
 *
 * The admin area is its own Cloudflare Pages project, so the marketplace and
 * the admin site link to each other across origins. Both builds read these;
 * the fallbacks are the production addresses, so a build with no override set
 * — the normal case — points at the live sites rather than at nothing.
 */
export const MAIN_URL =
  (import.meta.env.VITE_MAIN_URL as string | undefined) ?? 'https://autohiretech.pages.dev';

export const ADMIN_URL =
  (import.meta.env.VITE_ADMIN_URL as string | undefined) ?? 'https://autohiretech-admin.pages.dev';
