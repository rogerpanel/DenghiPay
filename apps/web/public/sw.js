/**
 * Service worker (BUILD_PLAN 10.7).
 *
 * Two rules, and the second one matters more than the first:
 *
 *  1. The application shell is cached, so opening the app on a dead connection
 *     shows the interface and an honest offline message rather than a browser
 *     error page.
 *  2. **No API response is ever cached.** A cached balance, quote or transfer
 *     status is worse than no data at all — a sender acting on a stale rate or
 *     a stale status makes a decision on something that is not true. Money
 *     endpoints are network-only, and they fail loudly.
 */

const CACHE = 'morapay-shell-v1';

const SHELL = [
  '/',
  '/home',
  '/send',
  '/transfers',
  '/settings',
  '/manifest.webmanifest',
  '/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Anything that is not this origin is the API or a third party. Never cached.
  if (url.origin !== self.location.origin) return;

  // Next.js build assets are content-hashed, so cache-first is safe and fast.
  //
  // Only successful same-origin responses are stored. Caching indiscriminately
  // is how a transient failure becomes a permanent one: a stylesheet request
  // that returns 400 during a deployment would be written to the cache under a
  // URL that never changes, and every later visit would be served the failure
  // from disk without ever asking the network again. The visible symptom is an
  // application that renders with no styling at all and cannot recover on
  // reload. A response we do not understand is passed through, not kept.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok && response.type === 'basic') {
              const copy = response.clone();
              void caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Navigations: network first, shell as the fallback. A sender who opens the
  // app underground gets the interface and a clear "you are offline" banner.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(request).then((hit) => hit ?? caches.match('/home'))),
    );
  }
});
