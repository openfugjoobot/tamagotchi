import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const index = readFileSync("index.html", "utf8");
const guide = readFileSync("guide.html", "utf8");

describe("html pages", () => {
  it("setzen das Theme vor dem ersten Paint (kein Theme-Flash)", () => {
    expect(existsSync("public/theme-init.js")).toBe(true);
    expect(index).toContain('src="/theme-init.js"');
    expect(guide).toContain('src="/theme-init.js"');
  });

  it("haben eine <h1> und einen noscript-Hinweis", () => {
    expect(index).toMatch(/<h1[^>]*class="sr-only"/);
    expect(guide).toContain("<h1");
    expect(index).toContain("<noscript>");
    expect(guide).toContain("<noscript>");
  });

  it("nutzen das 1200x630 Social-Card-Bild", () => {
    expect(index).toContain("icons/og.png");
    expect(index).toContain("summary_large_image");
    expect(existsSync("public/icons/og.png")).toBe(true);
  });

  it("haben robots.txt und sitemap.xml", () => {
    expect(readFileSync("public/robots.txt", "utf8")).toContain("Sitemap:");
    expect(readFileSync("public/sitemap.xml", "utf8")).toContain("</urlset>");
  });
});
