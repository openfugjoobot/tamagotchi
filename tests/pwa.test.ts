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
  it("service worker existiert", () => {
    expect(existsSync("public/sw.js")).toBe(true);
  });
});
