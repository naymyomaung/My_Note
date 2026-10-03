const CACHE_PREFIX = "my-note-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const APP_ROOT = new URL("./", self.registration.scope).toString();

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        await cache.add(APP_ROOT);
        const shell = await cache.match(APP_ROOT);
        if (!shell) throw new Error("Could not cache the app shell.");
        const html = await shell.text();
        const assetPaths = Array.from(html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g), (match) => match[1]);
        await cache.addAll(assetPaths.map((path) => new URL(path, APP_ROOT).toString()));
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached ?? await caches.match(APP_ROOT);
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
