// Tamagotchi PWA – Service Worker.
//
// Strategie:
//   * Navigation (HTML)      -> network-first, Fallback auf /offline.html
//      Die App-Shell selbst kommt aus dem Precache (Cache-first), damit der
//      Start offline sofort geht.
//   * Gehashte Assets        -> cache-first (Namen aendern sich pro Build)
//   * ROM/WASM               -> cache-first (gross, aendert sich nie)
//   * alles uebrige          -> stale-while-revalidate
//
// Update: neue Versionen warten, bis die Seite es erlaubt (SKIP_WAITING-Nachricht).
// So bleibt kein laufendes Spiel mitten in der Aufzucht stehen.

const VERSION = "__SW_VERSION__";
const CACHE = `tamagotchi-${VERSION}`;
const OFFLINE_URL = "/offline.html";

// Fallback, falls /precache.json (Build-Artefakt) fehlt oder nicht lesbar ist.
const FALLBACK = [
  "/",
  OFFLINE_URL,
  "/theme-init.js",
  "/manifest.webmanifest",
  "/icons/icon-192-v2.png",
  "/icons/icon-512-v2.png",
  "/emu/rom0.bin",
  "/emu/tamalib.wasm",
];

/** Precache: alles aus /precache.json (Build-Artefakt) holen. */
async function precache() {
  const cache = await caches.open(CACHE);
  let files = FALLBACK;
  try {
    const res = await fetch("/precache.json", { cache: "no-store" });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list.files)) files = FALLBACK.concat(list.files);
    }
  } catch { /* offline / kein Build-Artefakt */ }
  // deduplizieren, sonst holt der SW dieselbe Datei zweimal
  const unique = [...new Set(files)];
  await Promise.all(
    unique.map((f) => cache.add(f).catch(() => { /* fehlende Datei ignorieren */ })),
  );
}

self.addEventListener("install", (event) => {
  // Kein skipWaiting hier: die neue Version wartet auf die Freigabe durch die
  // Seite, damit ein laufendes Spiel nicht unterbrochen wird.
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Die Seite entscheidet, wann aktualisiert wird.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_VERSION") {
    event.source?.postMessage({ type: "VERSION", version: VERSION });
  }
});

const isHashedAsset = (p) => /-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?)$/.test(p);
const isBinary = (p) => p.endsWith(".wasm") || p.endsWith(".bin") || p.endsWith(".ico");

/** Netz zuerst, Cache als Rueckfall. Aktualisiert den Cache nebenbei. */
async function networkFirst(req, fallbackToOfflineDoc) {
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
    if (fallbackToOfflineDoc) {
      return (await caches.match(OFFLINE_URL)) || (await caches.match("/")) || Response.error();
    }
    return Response.error();
  }
}

/** Cache zuerst; im Hintergrund auffrischen. */
async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const c = await caches.open(CACHE);
      c.put(req, res.clone());
    }
    return res;
  } catch {
    return Response.error();
  }
}

/** Sofort aus dem Cache (falls da), parallel frisch holen und ablegen. */
async function staleWhileRevalidate(req) {
  const cached = await caches.match(req);
  const network = fetch(req)
    .then(async (res) => {
      if (res && res.ok) {
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
      }
      return res;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const p = url.pathname;

  // Nie abfangen: der SW selbst und die Precache-Liste sollen immer frisch sein.
  if (p === "/sw.js" || p === "/precache.json") return;

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, true));
    return;
  }

  if (isHashedAsset(p) || isBinary(p)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  event.respondWith(staleWhileRevalidate(req));
});

// ---- Background Sync: Cloud-Spielstand nachholen, wenn wieder Netz da ist ----
self.addEventListener("sync", (event) => {
  if (event.tag !== "tamagotchi-sync") return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: "SYNC_REQUESTED" });
    }
  })());
});

// ---- Periodic Background Sync (Chrome, installierte PWA) ----
self.addEventListener("periodicsync", (event) => {
  if (event.tag !== "tamagotchi-sync") return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: "SYNC_REQUESTED" });
    }
  })());
});

// ---- Notification-Klick: App fokussieren oder oeffnen ----
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if ("focus" in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow("/");
  })());
});
