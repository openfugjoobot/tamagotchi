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

  it("precache-Generator existiert", () => {
    expect(existsSync("scripts/gen-precache.mjs")).toBe(true);
  });
});
