import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createEmulator, LCD_WIDTH, LCD_HEIGHT } from "@/emu/emulator";
import { Pacer, unitsForMs, TS_PER_STEP } from "@/emu/clock";

const wasm = readFileSync("public/emu/tamalib.wasm");
const rom = readFileSync("public/emu/rom0.bin");

// Simuliert den Nachhol-Modus aus boot(): Backlog in Chunks abarbeiten, bis nichts
// mehr geschuldet ist. Es gibt kein Zeitlimit mehr – hier mit kleiner Chunk-Größe,
// damit mehrere Iterationen vorkommen.
async function drain(emu: { step(n?: number): void }, pacer: Pacer, chunkSteps: number, maxIter = 10_000): Promise<number> {
  let steps = 0;
  let iter = 0;
  while (pacer.owedUnits > 0 && iter++ < maxIter) {
    const n = pacer.take(chunkSteps);
    if (n <= 0) break;
    emu.step(n);
    steps += n;
  }
  return steps;
}

describe("Nachhol-Modus (kein Limit)", () => {
  it("arbeitet einen langen Backlog vollständig ab", async () => {
    const emu = await createEmulator({ wasm, rom });
    const pacer = new Pacer();
    const units = unitsForMs(5 * 60 * 1000); // 5 emulierte Minuten
    pacer.add(units);
    const chunk = 1_000_000; // < nötige Schritte ⇒ mehrere Iterationen
    const steps = await drain(emu, pacer, chunk);
    expect(pacer.owedUnits).toBe(0);
    expect(Math.abs(steps - Math.round(units / TS_PER_STEP))).toBeLessThanOrEqual(2);
    // Firmware lief echt weiter: Bildschirm rendert.
    const lcd = emu.lcd();
    expect(lcd.length).toBe(LCD_WIDTH * LCD_HEIGHT);
  });

  it("skaliert linear: doppelte Zeit ⇒ doppelte Schritte", async () => {
    const a = new Pacer();
    const b = new Pacer();
    a.add(unitsForMs(60 * 1000));
    b.add(unitsForMs(120 * 1000));
    const sa = await drain({ step() {} }, a, 5_000_000);
    const sb = await drain({ step() {} }, b, 5_000_000);
    expect(Math.abs(sb - 2 * sa)).toBeLessThanOrEqual(2);
  });
});
