// UPDATE THIS VERSION NUMBER WHENEVER YOU DEPLOY NEW CODE
const CACHE_NAME = 'gamenight-v2';

const ASSETS = [
  './',
  './index.html',
  './scramble.html',
  './scattergo.html',
  './vocabomb.html',
  './quiz.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// INSTALL: Force new Service Worker to activate immediately
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ACTIVATE: Delete ALL old caches immediately
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => clients.claim())
  );
});

// FETCH: Network-First strategy for HTML so fresh code is always loaded if online
self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request).then((networkResponse) => {
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, networkResponse.clone());
          return networkResponse;
        });
      }).catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then((res) => res || fetch(e.request))
    );
  }
});