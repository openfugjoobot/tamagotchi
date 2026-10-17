import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const index = readFileSync("index.html", "utf8");

describe("html page", () => {
  it("setzt das Theme vor dem ersten Paint (kein Theme-Flash)", () => {
    expect(existsSync("public/theme-init.js")).toBe(true);
    expect(index).toContain('src="/theme-init.js"');
  });

  it("hat eine <h1> und einen noscript-Hinweis", () => {
    expect(index).toMatch(/<h1[^>]*class="sr-only"/);
    expect(index).toContain("<noscript>");
  });

  it("nutzt das 1200x630 Social-Card-Bild", () => {
    expect(index).toContain("icons/og.png");
    expect(index).toContain("summary_large_image");
    expect(existsSync("public/icons/og.png")).toBe(true);
  });

  it("ist für Suchmaschinen gesperrt (robots + noindex, keine Sitemap)", () => {
    const robots = readFileSync("public/robots.txt", "utf8");
    expect(robots).toContain("Disallow: /");
    expect(robots).not.toContain("Sitemap:");
    expect(existsSync("public/sitemap.xml")).toBe(false);
    expect(index).toContain('name="robots" content="noindex');
  });

  it("verweist nur auf vorhandene Icon-Dateien", () => {
    for (const m of index.matchAll(/href="\/icons\/([^"]+)"/g)) {
      expect(existsSync(`public/icons/${m[1]}`)).toBe(true);
    }
  });

  it("hat keinen Verweis mehr auf die gelöschte guide.html", () => {
    expect(existsSync("guide.html")).toBe(false);
    expect(index).not.toContain("guide.html");
  });

  it("hat die Task-11-Ansichten (Tiere, Speicherstände, Beeps, Status)", () => {
    // Ein Pet-View-Fenster, ein Slots-Fenster und ein Beep-Fenster im win-Stil.
    expect(index).toMatch(/id="pets-pop"/);
    expect(index).toMatch(/id="pets-list"/);
    expect(index).toMatch(/id="slots-pop"/);
    expect(index).toMatch(/id="slots-list"/);
    expect(index).toMatch(/id="beeps-pop"/);
    expect(index).toMatch(/id="beeps-list"/);
    // Die Menueknoepfe, ueber die man sie oeffnet.
    expect(index).toMatch(/id="btn-pets"/);
    expect(index).toMatch(/id="btn-slots"/);
    expect(index).toMatch(/id="btn-beeps"/);
    // Der Verbindungsstatus-Indikator (Task-10-Mandat b).
    expect(index).toMatch(/id="conn-badge"/);
    expect(index).toMatch(/data-state="offline"/);
  });
});
