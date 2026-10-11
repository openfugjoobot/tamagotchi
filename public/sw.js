const CACHE = "tamagotchi-v4";

// Fallback, falls /precache.json (Build-Artefakt) fehlt oder nicht lesbar ist.
const FALLBACK = [
  "/",
  "/guide.html",
  "/theme-init.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/emu/rom0.bin",
  "/emu/tamalib.wasm",
];

// Alles vorab cachen, damit die App schon nach dem ersten Besuch offline läuft.
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let files = FALLBACK;
    try {
      const res = await fetch("/precache.json", { cache: "no-store" });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list.files)) files = FALLBACK.concat(list.files);
      }
    } catch { /* offline / kein Build-Artefakt */ }
    await Promise.all(files.map((f) => cache.add(f).catch(() => { /* fehlende Datei ignorieren */ })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Network-first für alles Same-Origin: online immer frisch, offline aus dem Cache.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
      }
      return res;
    } catch {
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === "navigate") return (await caches.match("/")) || Response.error();
      return Response.error();
    }
  })());
});
