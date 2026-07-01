const CACHE_VERSION = "v6";
const CACHE_NAME = `ms-connect-${CACHE_VERSION}`;
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./ms-icon.png",
  "./ms-logo.png",
  "./favicon.ico",
];

// Install Event: Cache all core UI assets without taking over the active page yet.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log(`PWA Service Worker: Caching core assets (${CACHE_VERSION})`);
      return cache.addAll(ASSETS_TO_CACHE);
    }),
  );
});

// Activate Event: Evict old cache frames and activate the new worker once it is ready.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log("PWA Service Worker: Clearing old cache:", cacheName);
              return caches.delete(cacheName);
            }
            return null;
          }),
        );
      })
      .then(() => self.clients.claim()),
  );
});

// Fetch Event: Serve assets from cache-first, with network fallback.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    }),
  );
});

// Allow the page to trigger the waiting service worker to take over immediately,
// and to ask the active worker which version it's serving.
self.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (event.data.type === "GET_VERSION") {
    event.source.postMessage({ type: "VERSION", version: CACHE_VERSION });
  }
});
