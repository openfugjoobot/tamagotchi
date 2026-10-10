import { describe, it, expect } from "vitest";
import { createFramebuffer } from "@/render/canvas";
import { SPRITES, ICONS } from "@/render/sprites";
import { renderScreen } from "@/render/screen";
import { createInitialState } from "@/engine/state";

describe("framebuffer", () => {
  it("setzt und liest Pixel", () => {
    const fb = createFramebuffer();
    fb.set(3, 4, true);
    expect(fb.get(3, 4)).toBe(true);
    expect(fb.get(0, 0)).toBe(false);
    fb.clear();
    expect(fb.get(3, 4)).toBe(false);
  });
});

describe("sprites", () => {
  it("hat Einträge für Ei und alle Charaktere", () => {
    expect(SPRITES.egg.length).toBeGreaterThan(0);
    expect(SPRITES.babytchi.length).toBeGreaterThan(0);
    expect(Object.keys(ICONS).length).toBeGreaterThanOrEqual(7);
  });
  it("Sprite-Zeilen sind höchstens 32 Zeichen breit", () => {
    for (const rows of Object.values(SPRITES)) {
      for (const r of rows) expect(r.length).toBeLessThanOrEqual(32);
    }
  });
});

describe("renderScreen", () => {
  it("rendert ohne Fehler und setzt Pixel", () => {
    const fb = createFramebuffer();
    const s = createInitialState(0, 42);
    renderScreen(fb, s, 0);
    let on = 0;
    for (let y = 0; y < fb.height; y++) for (let x = 0; x < fb.width; x++) if (fb.get(x, y)) on++;
    expect(on).toBeGreaterThan(0);
  });
});
