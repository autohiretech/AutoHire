// Deliberately minimal: this app's data (prices, availability, bookings)
// must never be served stale, so this worker does not cache API responses
// or app bundles — its only job is to exist, since a registered service
// worker with a fetch handler is one of Chrome's installability criteria
// for firing `beforeinstallprompt`. Every request just passes through to
// the network exactly as if there were no worker at all.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
