import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

describe("pwa", () => {
  it("manifest existiert und ist gültig", () => {
    const raw = readFileSync("public/manifest.webmanifest", "utf8");
    const m = JSON.parse(raw);
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBeTruthy();
    expect(m.icons.length).toBeGreaterThan(0);
  });

  it("manifest passt zur dunklen UI und ist installierbar", () => {
    const m = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
    expect(m.theme_color).toBe("#0a1a2e");
    expect(m.background_color).toBe("#0a1a2e");
    expect(m.id).toBeTruthy();
    expect(m.lang).toBeTruthy();
    expect(Array.isArray(m.categories)).toBe(true);
    expect(Array.isArray(m.screenshots)).toBe(true);
  });

  it("service worker precached beim Install (offline ab Besuch 1)", () => {
    expect(existsSync("public/sw.js")).toBe(true);
    const sw = readFileSync("public/sw.js", "utf8");
    expect(sw).toContain("precache.json");
    expect(sw).toMatch(/addEventListener\("install"/);
    expect(sw).toContain("caches.open(CACHE)");
  });

  it("manifest-Icons existieren", () => {
    const m = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
    for (const i of m.icons) expect(existsSync("public" + i.src)).toBe(true);
    for (const s of m.screenshots) expect(existsSync("public" + s.src)).toBe(true);
  });

  it("precache-Generator existiert", () => {
    expect(existsSync("scripts/gen-precache.mjs")).toBe(true);
  });

  it("Service Worker übernimmt Updates nicht ungefragt", () => {
    const sw = readFileSync("public/sw.js", "utf8");
    // install darf kein skipWaiting *aufrufen* – sonst reißt ein Update das laufende Spiel ab.
    // (Der Kommentar im Block nennt das Wort, deshalb auf den Aufruf prüfen.)
    expect(sw).toMatch(/addEventListener\("install"/);
    const installBlock = sw.slice(sw.indexOf('addEventListener("install"'), sw.indexOf('addEventListener("activate"'));
    expect(installBlock).not.toMatch(/self\.skipWaiting\(\)/);
    // Stattdessen: Freigabe über eine Nachricht.
    expect(sw).toContain("SKIP_WAITING");
  });

  it("Service Worker stempelt die Version erst beim Build", () => {
    const sw = readFileSync("public/sw.js", "utf8");
    expect(sw).toContain("__SW_VERSION__");
    const gen = readFileSync("scripts/gen-precache.mjs", "utf8");
    expect(gen).toContain("__SW_VERSION__");
    expect(gen).toContain("createHash");
  });

  it("Service Worker hat eine Offline-Seite als Navigations-Fallback", () => {
    const sw = readFileSync("public/sw.js", "utf8");
    expect(sw).toContain("/offline.html");
    expect(existsSync("public/offline.html")).toBe(true);
  });

  it("Service Worker cached pro Ressourcentyp unterschiedlich", () => {
    const sw = readFileSync("public/sw.js", "utf8");
    expect(sw).toContain("cacheFirst");
    expect(sw).toContain("staleWhileRevalidate");
    expect(sw).toContain("networkFirst");
  });

  it("Manifest nutzt display_override mit Fallback-Kette", () => {
    const m = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
    expect(Array.isArray(m.display_override)).toBe(true);
    expect(m.display_override).toContain("standalone");
    expect(m.display_override).toContain("window-controls-overlay");
  });

  it("Manifest hat Screenshots in beiden Formfaktoren", () => {
    const m = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
    const forms = m.screenshots.map((s: { form_factor: string }) => s.form_factor);
    expect(forms).toContain("wide");
    expect(forms).toContain("narrow");
  });

  it("Manifest deklariert Shortcuts mit existierenden URLs", () => {
    const m = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
    expect(Array.isArray(m.shortcuts)).toBe(true);
    expect(m.shortcuts.length).toBeGreaterThan(0);
    for (const s of m.shortcuts) expect(s.url.startsWith("/")).toBe(true);
  });

  it("Icons decken any und maskable ab", () => {
    const m = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
    const purposes = m.icons.map((i: { purpose?: string }) => i.purpose ?? "any");
    expect(purposes).toContain("any");
    expect(purposes).toContain("maskable");
  });

  it("HTML lädt den Service Worker über das PWA-Modul", () => {
    const main = readFileSync("src/main.ts", "utf8");
    expect(main).toContain("registerServiceWorker");
    expect(main).toContain("initPwa");
  });

  it("PWA-Modul fragt persistente Speicherung an", () => {
    const pwa = readFileSync("src/pwa.ts", "utf8");
    expect(pwa).toContain("navigator.storage");
    expect(pwa).toContain("persist");
  });

  it("HTML verlinkt Manifest, Icons und Preloads", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('rel="preload"');
    expect(html).toContain("theme-color");
  });
});
