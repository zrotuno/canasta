// Service worker for Rotuno Spite and Malice.
//
// Two jobs: make the app installable on Android and iOS home screens, and let
// it open without a connection once it has been visited.
//
// Bump CACHE when shipping a change, or phones will keep serving the old copy.
const CACHE = 'rotuno-v1';

const SHELL = [
  './',
  './index.html',
  './app.webmanifest',
  './src/engine/cards.js',
  './src/engine/game.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // A single missing file would reject addAll and abandon the whole
      // install, so each request is allowed to fail on its own.
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

  // Network first, so a push reaches players without waiting for a cache bump,
  // with the cached copy as the offline fallback.
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
