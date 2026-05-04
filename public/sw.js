// EffortOS Service Worker — cache-first for static, network-only for APIs
//
// SECURITY: never cache /api/* or /auth/*.
//
// The previous v1 used cache-first for everything that wasn't HTML, which
// meant authenticated /api/* responses (subscription status, daily tasks,
// reports, etc.) got stored in the cache. After a logout — or a different
// user signing in on the same device — the cache could serve the previous
// user's private data because the cache key is just the URL.
//
// Bumping CACHE_NAME forces the activate handler to wipe the v1 cache
// (which may already contain /api/* entries from prior visits).
const CACHE_NAME = 'effortos-v2';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Skip non-GET and external requests
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // ── HARD BYPASS for sensitive paths ─────────────────────────────────
  // Never read from cache, never write to cache. The browser handles
  // these directly so credentials/cookies always go to the network.
  //
  // - /api/*    : authenticated JSON. Caching = cross-user data leak.
  // - /auth/*   : OAuth callbacks, session exchange. Must hit network.
  // - /admin/*  : admin pages must always re-validate.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/admin/')
  ) {
    return; // fall through to default browser handling — no SW intervention
  }

  // ── Network-first for HTML pages (with cache fallback for offline) ──
  // Caching the HTML shell is OK because it doesn't contain user data —
  // the React app re-hydrates state by calling /api/* (which we never
  // cache), and any unauthenticated render shows the landing/auth UI.
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // ── Cache-first for static assets (CSS/JS/fonts/images/sw worker) ──
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});

// ── Web Push (mig 042) ────────────────────────────────────────────────
// The server sends an encrypted JSON payload of shape
// { title, body, url?, tag? }. We render a notification with the title
// and body, and capture the URL for use when the user clicks it.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'EffortOS', body: event.data.text() };
  }
  const { title = 'EffortOS', body = '', url = '/', tag } = payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.svg',
      badge: '/icon-192.svg',
      tag, // collapse same-tag notifications so streak alerts don't pile up
      data: { url },
    })
  );
});

// Click handler — focus an existing tab if one's already open at our
// origin, otherwise open a new one to the URL the payload requested.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          // Same-origin tab: navigate it to the target URL and focus.
          client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
