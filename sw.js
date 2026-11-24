// Service worker: makes the app installable and usable offline.
// Strategy: serve from cache, refresh the cache in the background (stale-while-revalidate).
// Bump VERSION on each release so old caches are dropped.
const VERSION = 'auguste-1';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/i18n.js',
  'js/rhythm.js',
  'js/scoring.js',
  'js/exercises.js',
  'js/score.js',
  'js/audio.js',
  'js/app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/meyda@5.6.3/dist/web/meyda.min.js',
  'https://cdn.jsdelivr.net/npm/vexflow@4.2.5/build/cjs/vexflow.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Only the app's own files, its libraries and fonts are cached; API calls (sync) always go to the network.
const CACHED_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin && !CACHED_HOSTS.includes(url.hostname)) return;
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      const network = fetch(event.request)
        .then((res) => { if (res.ok || res.type === 'opaque') cache.put(event.request, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
