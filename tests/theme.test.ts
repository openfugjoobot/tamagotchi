import { describe, it, expect } from "vitest";
import { BG_KEY, THEMES, THEME_IDS, savedBg } from "@/theme";

function memStorage(init: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(init));
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, v) => { map.set(k, v); },
  } as Storage;
}

describe("theme", () => {
  it("hat sechs Themes mit eindeutigen IDs", () => {
    expect(THEMES.length).toBe(6);
    expect(new Set(THEME_IDS).size).toBe(6);
    expect(THEME_IDS).toContain("day");
  });

  it("savedBg liefert Gespeichertes oder 'day'", () => {
    expect(savedBg(memStorage())).toBe("day");
    expect(savedBg(memStorage({ [BG_KEY]: "midnight" }))).toBe("midnight");
    expect(savedBg(memStorage({ [BG_KEY]: "bogus" }))).toBe("day");
  });
});
