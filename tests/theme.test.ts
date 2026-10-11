import { describe, it, expect } from "vitest";
import { BG_KEY, THEMES, THEME_IDS, AUTO, savedBg, resolveTheme, phaseForHour } from "@/theme";

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
  it("ist chronologisch sortiert (Morgen → Nacht), 'auto' am Ende", () => {
    expect(THEMES.length).toBe(6);
    expect(new Set(THEME_IDS).size).toBe(6);
    expect(THEME_IDS).toEqual(["blossom", "day", "dusk", "night", "midnight", AUTO]);
    expect(THEME_IDS).not.toContain("forest");
  });

  it("savedBg liefert Gespeichertes, sonst 'auto'", () => {
    expect(savedBg(memStorage())).toBe(AUTO);
    expect(savedBg(memStorage({ [BG_KEY]: "midnight" }))).toBe("midnight");
    expect(savedBg(memStorage({ [BG_KEY]: AUTO }))).toBe(AUTO);
    expect(savedBg(memStorage({ [BG_KEY]: "bogus" }))).toBe(AUTO);
  });

  it("löst 'auto' nach Tageszeit auf", () => {
    expect(phaseForHour(2)).toBe("midnight");
    expect(phaseForHour(6)).toBe("blossom");
    expect(phaseForHour(12)).toBe("day");
    expect(phaseForHour(18)).toBe("dusk");
    expect(phaseForHour(21)).toBe("night");
    expect(phaseForHour(23)).toBe("midnight");
    expect(resolveTheme(AUTO, new Date(2026, 0, 1, 12, 0, 0))).toBe("day");
    expect(resolveTheme("dusk", new Date(2026, 0, 1, 3, 0, 0))).toBe("dusk");
  });
});
