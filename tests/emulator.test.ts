import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createEmulator, LCD_WIDTH, LCD_HEIGHT } from "@/emu/emulator";

const wasm = readFileSync("public/emu/tamalib.wasm");
const rom = readFileSync("public/emu/rom0.bin");

describe("emulator", () => {
  it("führt die echte Firmware aus und rendert Pixel", async () => {
    const emu = await createEmulator({ wasm, rom });
    emu.step(20_000);
    const lcd = emu.lcd();
    expect(lcd.length).toBe(LCD_WIDTH * LCD_HEIGHT);
    let on = 0;
    for (const v of lcd) if (v) on++;
    expect(on).toBeGreaterThan(0);
  });

  it("state round-trip behält die Größe", async () => {
    const emu = await createEmulator({ wasm, rom });
    emu.step(1_000);
    const s = emu.saveState();
    expect(() => emu.loadState(s)).not.toThrow();
  });
});
