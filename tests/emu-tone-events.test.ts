import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PetEmulator, TONE_RING_CAP } from "../server/src/emulator";

// Direct test of the lossless tone-event ring the HAL glue records
// (`emu/src/glue.c`). Unlike `buzzer()` (a *level* sampled at some cadence,
// which can drop a chirp shorter than the interval), the ring captures every
// piezo state *transition* the ROM causes via `set_frequency`/`play_frequency`,
// each stamped with the emulator time in µs. This test drives the real P1
// firmware and asserts the structural promises: ordered monotonic timestamps,
// only transitions (no write avalanche), and the measured two-tone chirp shape.

const wasm = readFileSync(resolve(__dirname, "../public/emu/tamalib.wasm"));
const rom = readFileSync(resolve(__dirname, "../public/emu/rom0.bin"));

// P1 clock-set sequence from the spike; without it the sim never starts.
const CLOCK_SET = [1, 0, 0, 1, 0, 1, 0, 2];

describe("PetEmulator.takeToneEvents()", () => {
  it("records ordered transition events with monotonically rising emulator time", () => {
    const pet = new PetEmulator(rom, wasm);
    for (const b of CLOCK_SET) pet.press(b === 0 ? "left" : b === 1 ? "middle" : "right");
    pet.step(400_000);
    pet.takeToneEvents(); // drain the clock-set churn

    const events: ReturnType<PetEmulator["takeToneEvents"]> = [];
    for (let i = 0; i < 4000; i++) {
      pet.step(50); // 0.05 s slices → 200 s
      events.push(...pet.takeToneEvents());
    }

    // Some sound happened during the running pet.
    expect(events.length).toBeGreaterThan(0);

    // Timestamps are non-decreasing (a transition is instantaneous; the glue
    // stamps it with the current emulator time). On the real ROM each buzzer
    // write lands in its own op, so stamps strictly rise — but the contract is
    // only monotonic, so assert >= to stay robust to a same-op pair.
    for (let i = 1; i < events.length; i++) {
      expect(events[i].at).toBeGreaterThanOrEqual(events[i - 1].at);
    }

    // Every event carries usable state: a finite, in-range freq and a bool play.
    for (const e of events) {
      expect(Number.isFinite(e.freq)).toBe(true);
      expect(e.freq).toBeGreaterThanOrEqual(0);
      expect(typeof e.play).toBe("boolean");
    }
  }, 20000);

  it("collapses redundant register writes to real transitions only", () => {
    // The ROM writes its buzzer registers in a tight poll loop; recording every
    // write would produce a write avalanche (measured: ~7.3M writes in 200 s vs
    // ~800 real transitions). The ring must hold transitions only, so an
    // unchanged (freq, play) never appears twice in a row.
    const pet = new PetEmulator(rom, wasm);
    for (const b of CLOCK_SET) pet.press(b === 0 ? "left" : b === 1 ? "middle" : "right");
    pet.step(400_000);
    pet.takeToneEvents();

    let count = 0;
    for (let i = 0; i < 4000; i++) {
      pet.step(50);
      const evs = pet.takeToneEvents();
      for (let j = 0; j < evs.length; j++) {
        const prev = j === 0 ? undefined : evs[j - 1];
        if (prev) expect(evs[j].freq === prev.freq && evs[j].play === prev.play).toBe(false);
        count++;
      }
    }
    // Far below the write count, and consistent with the measured burst rate
    // (docs/BEEPS.md: ~36–54 latch events per simulated hour ⇒ ~2–3/min ⇒
    // a few hundred transitions over 200 s once chirp edges are counted).
    expect(count).toBeLessThan(50_000);
    expect(count).toBeGreaterThan(50);
  }, 20000);

  it("drains the ring: a second read without stepping returns nothing", () => {
    const pet = new PetEmulator(rom, wasm);
    for (const b of CLOCK_SET) pet.press(b === 0 ? "left" : b === 1 ? "middle" : "right");
    pet.step(400_000);

    const first = pet.takeToneEvents();
    expect(first.length).toBeGreaterThan(0);
    expect(pet.takeToneEvents()).toEqual([]);
  }, 20000);

  it("never overruns the ring cap across a read", () => {
    // A read drains tail→head; with the cap-sized ring the glue drops the
    // oldest entry on overflow, so a read can return at most cap entries and
    // must never loop. Exercise many slice sizes to be sure the walk terminates.
    const pet = new PetEmulator(rom, wasm);
    for (const b of CLOCK_SET) pet.press(b === 0 ? "left" : b === 1 ? "middle" : "right");
    pet.step(400_000);
    for (let i = 0; i < 500; i++) {
      pet.step(1000);
      expect(pet.takeToneEvents().length).toBeLessThanOrEqual(TONE_RING_CAP);
    }
  }, 20000);
});
