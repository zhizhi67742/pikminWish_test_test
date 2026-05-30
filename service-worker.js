const CACHE_NAME = "pikminwish-v-mobile-login-fix-20260531-004";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./favicon.ico",
  "./icon-16.png",
  "./icon-32.png",
  "./icon-48.png",
  "./icon-192.png",
  "./icon-512.png",
  "./js/app.js?v=mobile-login-fix-20260531-004",
  "./css/style.css?v=mobile-login-fix-20260531-004"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => key !== CACHE_NAME ? caches.delete(key) : null))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;

  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      fetch(req).catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        return response;
      })
      .catch(() => caches.match(req))
  );
});
