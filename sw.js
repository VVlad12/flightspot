// Offline cache. Bump VERSION whenever any file changes so phones pick up the update.
const VERSION = 'flightspot-0.1.2';
const FILES = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/solar.js',
  'js/projection.js',
  'js/sensors.js',
  'js/render.js',
  'js/geo.js',
  'js/feed.js',
  'js/sim.js',
  'js/airlines.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so a reload after a push shows the new version), cache as offline fallback.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never cache live traffic (only cache the app's own files).
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/v2/point/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
