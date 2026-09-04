const CACHE_NAME = 'gamenight-v84';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './quiz.html',
  './scattergo.html',
  './scramble.html',
  './vocabomb.html',
  './manifest.json'
];

// Force new service worker to activate immediately without waiting for tabs to close
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Purge all legacy caches on activation
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Purging legacy cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Serve network version first; fallback to offline cache if network fails
self.addEventListener('fetch', (event) => {
  // Ignore non-GET requests (POST requests to /api/questions cannot be cached by the browser)
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});