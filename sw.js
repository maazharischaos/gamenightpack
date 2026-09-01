// INCREMENT THIS VERSION NUMBER (e.g., v3, v4) WHENEVER YOU DEPLOY NEW CODE
const CACHE_NAME = 'gamenight-v3';

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

// INSTALL: Force the new Service Worker to activate immediately
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ACTIVATE: Immediately delete all outdated caches
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

// FETCH: Network-First strategy for HTML navigation so updated code is always fetched when online
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