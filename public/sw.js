const CACHE = "tamagotchi-v2";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isDocument =
    req.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html");

  if (isDocument) {
    // Network-first: immer die aktuelle Shell holen, sonst Cache.
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req)) || Response.error();
      }
    })());
    return;
  }

  // Assets: cache-first (nach dem ersten Laden offline verfügbar).
  event.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    const c = await caches.open(CACHE);
    c.put(req, res.clone());
    return res;
  })());
});
