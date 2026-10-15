// Service worker: makes the Life List installable and usable offline.
// - The app itself (pages, code, species list, icons) is cached on install and
//   refreshed in the background, so updates arrive on the next launch.
// - Photos and map tiles you have viewed are kept (cache first, capped).
// - API answers (iNaturalist, GBIF, Wikipedia, OpenAlex) come from the network
//   when online and from the last saved copy when offline.
// - The local chat/summary API (/api/) is never cached, and neither is account
//   sign-in or sync (Firebase talks to Google's servers directly).
const VERSION = 'v2';
const SHELL = `shell-${VERSION}`;
const MEDIA = 'media-v1';
const TILES = 'tiles-v1';
const DATA = 'data-v1';
const LIMITS = { [MEDIA]: 800, [TILES]: 2500, [DATA]: 600 };
const SHELL_FILES = [
  './', 'index.html', 'app.js', 'styles.css', 'data/species.js', 'manifest.webmanifest', 'firebase-config.js', 'vendor/firebase/cloud.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png', 'icons/apple-touch-icon.png',
];
const TILE_HOSTS = /(^|\.)tile\.openstreetmap\.org$|(^|\.)tile\.opentopomap\.org$|^server\.arcgisonline\.com$/;
const TILE_PATHS = /^\/v1\/(grid|points|taxon_ranges|geomodel|places)\/|^\/v2\/map\//;
const DATA_HOSTS = /^api\.inaturalist\.org$|^api\.gbif\.org$|(^|\.)wikipedia\.org$|^api\.openalex\.org$/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL, MEDIA, TILES, DATA]);
  event.waitUntil(caches.keys()
    .then((names) => Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

// Only CORS or same-origin responses are stored: opaque ones can't be checked
// and browsers count each as several megabytes of storage.
const storable = (res) => res && res.ok && (res.type === 'basic' || res.type === 'cors');

async function put(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  const limit = LIMITS[cacheName];
  if (!limit) return;
  const keys = await cache.keys();
  for (const old of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(old); // oldest first
}

async function staleWhileRevalidate(event, cacheKey) {
  const cached = await caches.match(cacheKey, { ignoreSearch: true });
  const network = fetch(event.request).then((res) => {
    if (storable(res)) event.waitUntil(put(SHELL, cacheKey, res.clone()));
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(network); return cached; }
  return (await network) || Response.error();
}

async function cacheFirst(event, cacheName) {
  const cached = await caches.match(event.request);
  if (cached) return cached;
  const res = await fetch(event.request);
  if (storable(res)) event.waitUntil(put(cacheName, event.request, res.clone()));
  return res;
}

async function networkFirst(event) {
  try {
    const res = await fetch(event.request);
    if (storable(res)) event.waitUntil(put(DATA, event.request, res.clone()));
    return res;
  } catch (err) {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return; // live chat and summaries only
    if (request.mode === 'navigate') { event.respondWith(staleWhileRevalidate(event, new URL('index.html', self.registration.scope).href)); return; }
    event.respondWith(staleWhileRevalidate(event, request));
    return;
  }
  if (TILE_HOSTS.test(url.hostname) || (DATA_HOSTS.test(url.hostname) && TILE_PATHS.test(url.pathname))) {
    event.respondWith(cacheFirst(event, TILES));
    return;
  }
  if (request.destination === 'image') { event.respondWith(cacheFirst(event, MEDIA)); return; }
  if (DATA_HOSTS.test(url.hostname)) event.respondWith(networkFirst(event));
});
