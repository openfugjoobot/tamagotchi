import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Beep-probe: characterises the buzzer latch over a real neglect run.
//
// The design spec marked Anhang A4 ("the piezo gives no reason") as *not
// measured* in the 2026-10-17 spike. This probe settles it: it runs the P1
// firmware without ever feeding the pet, samples the buzzer latch
// (`emu_take_buzzer()`) and the live piezo state (`emu_en()`), and prints the
// observed numbers. The findings live in docs/BEEPS.md.
//
// The probe is deliberately slow: two simulated days take ~90 s of wall clock
// (TamaLIB steps one CPU cycle at a time; see Anhang A5). It is a measurement
// test, not a fast unit test.

const wasm = readFileSync(resolve(__dirname, "../public/emu/tamalib.wasm"));
const rom = readFileSync(resolve(__dirname, "../public/emu/rom0.bin"));
const TS_PER_STEP = 5.648;
const TS_FREQ = 32768;
const SPS = Math.round(TS_FREQ / TS_PER_STEP);

// P1 buttons: A=left(0), B=middle(1), C=right(2).
const A = 0,
  B = 1,
  C = 2;

// The clock-set sequence discovered in the spike; without it the simulation
// never starts (Anhang A2).
const CLOCK_SET = [B, A, A, B, A, B, A, C];

// Measured facts (2026-10-17, this host, node v26.10.0). Recorded with margin
// so the test fails if the firmware or HAL glue drifts, without being flaky.
const MEASURED = {
  // 2 simulated days at 0.2 s sampling.
  frames: 2 * 86400 / 0.2, // 864_000
  latchCount: 680,
  enCount: 685,
};

describe("beep latch probe", () => {
  it("records beeps while a pet is neglected to death", async () => {
    const module = new WebAssembly.Module(wasm as BufferSource);
    const e = new WebAssembly.Instance(module, {}).exports as Record<string, any>;

    for (let i = 0; i < rom.length; i++) e.emu_rom_byte(i, rom[i]);
    e.emu_init();

    const sec = (s: number) => {
      const n = Math.round(s * SPS);
      if (n > 0) e.emu_step_n(n);
    };
    const press = (b: number) => {
      e.emu_set_button(b, 1);
      sec(0.4);
      e.emu_set_button(b, 0);
      sec(0.4);
    };

    // Set the clock, else the simulation never starts.
    for (const b of CLOCK_SET) press(b);
    sec(400);

    let latchCount = 0,
      enCount = 0,
      frames = 0;
    const samples: number[] = [];
    // 2 simulated days at 0.2 s resolution.
    for (let i = 0; i < MEASURED.frames; i++) {
      sec(0.2);
      if (e.emu_take_buzzer()) {
        latchCount++;
        samples.push(i * 0.2);
      }
      if (e.emu_en()) enCount++;
      frames++;
    }

    // eslint-disable-next-line no-console
    console.log({ latchCount, enCount, frames, firstBeeps: samples.slice(0, 20) });

    // The probe must actually run the firmware.
    expect(frames).toBeGreaterThan(0);
    expect(frames).toBe(MEASURED.frames);

    // The latch does fire over a neglect run — the whole point of the probe.
    // Task 4's push logic may therefore read the latch; no emu_en() fallback is
    // needed. Guard the measured magnitudes within a wide margin.
    expect(latchCount).toBeGreaterThan(400);
    expect(latchCount).toBeLessThan(1000);

    // The latch and en-count sit in the same ballpark over the run.
    expect(enCount).toBeGreaterThan(400);
    expect(enCount).toBeLessThan(1000);
  }, 600_000);
});

describe("beep latch: death stops the buzzer", () => {
  it("stops latching once the pet is dead", async () => {
    // A second, shorter probe: 14 simulated hours. Death lands at ~11.44 h
    // (41 200 s) in the 2026-10-17 run, so the last ~2.5 h are post-death.
    const module = new WebAssembly.Module(wasm as BufferSource);
    const e = new WebAssembly.Instance(module, {}).exports as Record<string, any>;
    for (let i = 0; i < rom.length; i++) e.emu_rom_byte(i, rom[i]);
    e.emu_init();
    const sec = (s: number) => {
      const n = Math.round(s * SPS);
      if (n > 0) e.emu_step_n(n);
    };
    const press = (b: number) => {
      e.emu_set_button(b, 1);
      sec(0.4);
      e.emu_set_button(b, 0);
      sec(0.4);
    };
    for (const b of CLOCK_SET) press(b);
    sec(400);

    // Death is detected on the angel frame at ~41 200 s (10 s resolution). The
    // last latch ever observed in the 2026-10-17 run fires at 41 204.1 s — the
    // tail of the final burst straddles the death instant. Allow a 10 s
    // settling window before asserting silence.
    const DEATH = 41_200;
    const SETTLE = 10;
    let beforeDeath = 0,
      afterDeath = 0,
      lastLatch = 0;
    const chunks = Math.round(14 * 3600 / 0.2); // 14 h at 0.2 s
    for (let i = 0; i < chunks; i++) {
      sec(0.2);
      const t = (i + 1) * 0.2;
      if (e.emu_take_buzzer()) {
        lastLatch = t;
        if (t < DEATH) beforeDeath++;
        else afterDeath++;
      }
    }

    // Beeps were observed before death …
    expect(beforeDeath).toBeGreaterThan(400);
    // … the last latch lands within the settling window of death …
    expect(lastLatch).toBeLessThanOrEqual(DEATH + SETTLE);
    // … and at most the two straddling the death instant fall in it.
    expect(afterDeath).toBeLessThanOrEqual(2);
    expect(lastLatch).toBeGreaterThan(DEATH - 200);
  }, 600_000);
});
