import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PetEmulator } from "../server/src/emulator";

// Direct test of the server-side piezo read that feeds `{t:"buzzer"}`.
//
// `PetEmulator.buzzer()` is the only place the live beep's *level* (freq/on)
// enters the server; every other buzzer test uses a fake pet, so a wrong
// `emu_freq()`/`emu_en()` mapping would pass them all while leaving the live
// view tone-deaf. This drives the real P1 firmware and asserts the shape the
// protocol promises, and that the values are the raw HAL glue read
// (`{freq: emu_freq(), on: emu_en() !== 0}`) — byte-for-byte the same mapping
// the old in-tab emulator used (git f99149c) before the server owned the pet.
// The client keeps its own unit conversion (`src/emu/audio.ts`), so the server
// must NOT rescale.
//
// Fast by design: it only runs the boot/clock-set churn (hour 0), where the
// measured probe (docs/BEEPS.md) sees a buzzer burst within the first ~20 s,
// not a full two-day neglect run.

const wasm = readFileSync(resolve(__dirname, "../public/emu/tamalib.wasm"));
const rom = readFileSync(resolve(__dirname, "../public/emu/rom0.bin"));

// P1 buttons: A=left(0), B=middle(1), C=right(2); clock-set sequence from the
// spike (Anhang A2) — without it the simulation never starts.
const B = 1,
  A = 0,
  C = 2;
const CLOCK_SET = [B, A, A, B, A, B, A, C];

describe("PetEmulator.buzzer()", () => {
  it("reports the raw glue level {freq, on} that the client consumes", () => {
    const pet = new PetEmulator(rom, wasm);
    // Before settling, the read is total: a silent pet reports off/zero.
    const initial = pet.buzzer();
    expect(typeof initial.freq).toBe("number");
    expect(Number.isFinite(initial.freq)).toBe(true);
    expect(initial.freq).toBeGreaterThanOrEqual(0);
    expect(typeof initial.on).toBe("boolean");

    // Set the clock; boot churn produces buzzer bursts (docs/BEEPS.md hour 0,
    // 527 latches). Then settle, exactly like the probe (`sec(400)`), so the
    // sampling window lands on a running, beeping pet.
    for (const b of CLOCK_SET) pet.press(b === A ? "left" : b === B ? "middle" : "right");
    pet.step(400_000);

    // Step in short slices and record every distinct piezo state seen. The probe
    // samples at 0.05 s; finer than the burst gap keeps the on/off edges.
    const states: Array<{ freq: number; on: boolean }> = [];
    for (let i = 0; i < 4000; i++) {
      pet.step(50); // 0.05 s slices → 200 s of emulated time
      const b = pet.buzzer();
      const last = states[states.length - 1];
      if (!last || last.freq !== b.freq || last.on !== b.on) states.push(b);
    }

    // Every reported state keeps the promised shape (coerced later by the hub,
    // but the raw read must already be sane).
    for (const s of states) {
      expect(Number.isFinite(s.freq)).toBe(true);
      expect(s.freq).toBeGreaterThanOrEqual(0);
      expect(typeof s.on).toBe("boolean");
    }

    // The buzzer went audible at least once in the boot churn, and every time
    // it was on it carried a real frequency, never 0.
    const audible = states.filter((s) => s.on);
    expect(audible.length).toBeGreaterThan(0);
    for (const s of audible) expect(s.freq).toBeGreaterThan(0);

    // Frequencies match the probe's measured piezo set (docs/BEEPS.md) as the
    // raw glue reports them: the ROM drives ~23 406 / 27 307 / 32 768 Hz.
    // (The client divides by 10 before the oscillator; the server passes them
    // through untouched — the old in-tab emulator did the same.)
    const seenFreqs = new Set(audible.map((s) => s.freq));
    const MEASURED = [23406, 27307, 32768];
    expect([...seenFreqs].some((f) => MEASURED.includes(f))).toBe(true);
  }, 20000);
});
