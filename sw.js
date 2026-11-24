const CACHE_NAME = "laundysync-v7-offline-print";
const APP_FILES = [
  "./", "./index.html", "./style.css", "./app.js", "./backend.js",
  "./config.js", "./manifest.json"
];
const OPTIONAL_LIBRARY_FILES = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
  "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"
];
const LIBRARY_HOSTS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Local application files are required for the offline shell.
    await cache.addAll(APP_FILES);
    // QRCode.js is needed for offline receipt QR generation after the first
    // successful online installation. Cache it when reachable, but never let
    // an unavailable CDN prevent the app shell from installing.
    // Camera scanning is optional and is not required for printing.
    await Promise.allSettled(OPTIONAL_LIBRARY_FILES.map(url => cache.add(url)));
  })());
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const request = event.request;
  const url = new URL(request.url);
  const local = url.origin === self.location.origin;
  const library = LIBRARY_HOSTS.includes(url.hostname);
  if (!local && !library) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    if (local && url.pathname.endsWith("/config.js")) {
      try {
        const response = await fetch(request);
        if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
        return response;
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    }

    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && (response.ok || response.type === "opaque")) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (error) {
      if (local) {
        const fallback = await cache.match("./index.html");
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});
