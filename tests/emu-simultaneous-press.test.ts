import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PetEmulator } from "../server/src/emulator";

// Simultaneous button presses (SELECT+NEXT = A+C) against the real P1 ROM.
//
// The server materialises input over owed real time. Before this fix `press()`
// queued one button at a time, so two buttons were never LOW in the same sampled
// frame. The P1 firmware samples the button matrix per frame, and its sound
// toggle is A+C **held together** — a combination the sequential model could
// never deliver. The API this test pins:
//
//   press(btn, true)  → assert (hold)
//   press(btn, false) → release
//   press(btn)        → legacy self-contained tap (down + deferred up)
//
// Ground truth (measured, this host, node v26.10.0, against the real P1 ROM):
// engaging A+C together mutes the piezo (emu_en() collapses to ~0 over a
// neglect window), whereas A-then-C sequential taps leave the pet beeping.

const wasm = readFileSync(resolve(__dirname, "../public/emu/tamalib.wasm"));
const rom = readFileSync(resolve(__dirname, "../public/emu/rom0.bin"));

type Btn = "left" | "middle" | "right";
const A: Btn = "left";
const B: Btn = "middle";
const C: Btn = "right";
const CLOCK_SET: Btn[] = [B, A, A, B, A, B, A, C];

/**
 * Set the clock with eight discrete taps, then settle ~400 s — the spike's
 * `sec(400)`. Without the settle the ROM is still in the boot churn (silent),
 * which would make the piezo assertions meaningless.
 */
function boot(pet: PetEmulator): void {
  for (const b of CLOCK_SET) pet.press(b);
  pet.step(8 * 800 + 400_000); // 8 taps (each 800 ms) + 400 s settle
}

/** Count piezo activity over a real stretch (0.2 s slices). */
function piezoActivity(pet: PetEmulator, seconds: number): number {
  let en = 0;
  const slices = Math.round(seconds / 0.2);
  for (let i = 0; i < slices; i++) {
    pet.step(200);
    if (pet.buzzer().on) en++;
  }
  return en;
}

describe("simultaneous A+C against the real P1 ROM", () => {
  it("mutes when A and C are asserted together (hold API)", () => {
    const pet = new PetEmulator(rom, wasm);
    boot(pet);
    // Two overlapping holds, released later — a physical two-finger press.
    pet.press(A, true);
    pet.press(C, true);
    pet.step(500); // both held LOW across the sampled frames
    pet.press(A, false);
    pet.press(C, false);

    expect(piezoActivity(pet, 180)).toBeLessThanOrEqual(2);
  });

  it("does NOT mute when A then C are separate taps", () => {
    const pet = new PetEmulator(rom, wasm);
    boot(pet);
    // Each tap is self-contained; A and C are never LOW together.
    pet.press(A);
    pet.step(900);
    pet.press(C);
    pet.step(900);

    expect(piezoActivity(pet, 180)).toBeGreaterThan(10);
  });

  it("grants the same emulated time with and without an explicit hold", () => {
    // The hold path must never mint time: two pets fed identical real durations
    // end with identical CPU-step budgets, whatever buttons are held.
    const held = new PetEmulator(rom, wasm);
    const idle = new PetEmulator(rom, wasm);
    boot(held);
    boot(idle);
    const heldBase = held.steps();
    const idleBase = idle.steps();

    held.press(A, true);
    held.press(C, true);
    for (let i = 0; i < 20; i++) {
      held.step(50);
      idle.step(50);
    }
    held.press(A, false);
    held.press(C, false);
    held.step(500);
    idle.step(500);

    expect(held.steps() - heldBase).toBe(idle.steps() - idleBase);
  });
});
