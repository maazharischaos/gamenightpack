const CACHE_NAME = 'gamenight-v6'; // <--- Incremented from v1 to force cache purge

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './quiz.html',
  './scattergo.html',
  './scramble.html',
  './vocabomb.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Install Event - Pre-cache all app assets
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Instantly activate new service worker
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Activate Event - Clean up old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key); // Deletes old gamenight-v1 cache
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Network first for HTML, fallback to cache
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});