// Service worker for Canasta — Fifty Years.
//
// Makes the game installable on Android and iOS home screens and lets it open
// without a connection once visited. Bump CACHE when shipping, or phones will
// keep serving the previous copy.
const CACHE = 'canasta-v1';

const SHELL = [
  './',
  './index.html',
  './app.webmanifest',
  './src/engine/cards.js',
  './src/engine/melds.js',
  './src/engine/game.js',
  './src/ui/board.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // One missing file would reject addAll and abandon the whole install,
      // so each request is allowed to fail on its own.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  // Network first so an update reaches players promptly, cache as the offline
  // fallback.
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
  );
});
