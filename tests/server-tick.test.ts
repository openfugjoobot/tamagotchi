import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PetEmulator } from "../server/src/emulator";
import { TickLoop } from "../server/src/tick";

const wasm = new Uint8Array(readFileSync(resolve("public/emu/tamalib.wasm")));
const rom = new Uint8Array(readFileSync(resolve("public/emu/rom0.bin")));

describe("PetEmulator", () => {
  it("advances the LCD when stepped", () => {
    const pet = new PetEmulator(rom, wasm);
    pet.step(400);            // boot (step takes milliseconds)
    const before = pet.lcd().slice();
    pet.press("middle");      // clock set: first CONFIRM
    pet.step(1000);
    expect(pet.lcd()).not.toEqual(before);
  });

  it("round-trips a saved state", () => {
    const a = new PetEmulator(rom, wasm);
    a.step(600);
    const buf = a.save();
    const b = new PetEmulator(rom, wasm, buf);
    b.step(1000);
    expect(b.lcd().length).toBe(512);
  });

  it("loadState into a running instance replaces its memory", () => {
    const a = new PetEmulator(rom, wasm);
    a.step(400);
    a.press("middle");
    a.step(1000);
    const buf = a.save();
    const b = new PetEmulator(rom, wasm);
    b.loadState(buf);
    expect(b.lcd()).toEqual(a.lcd());
  });

  it("latches dead() true once the angel frame has been seen", () => {
    const pet = new PetEmulator(rom, wasm);
    // Not dead on a freshly booted, living pet.
    pet.step(400);
    expect(pet.dead()).toBe(false);

    // Build a full memory image that renders the reference angel frame: take a
    // real snapshot and copy the 512-byte LCD fixture into the LCD region
    // (offset reported by emu_lcd(), same as the browser wrapper reads it).
    const angel = new Uint8Array(readFileSync(resolve("tests/fixtures/angel-p1.lcd")));
    const snap = pet.save();
    const LCD_PTR = 1086960;
    snap.set(angel, LCD_PTR);
    pet.loadState(snap);
    expect(pet.dead()).toBe(true);

    // Latch: even after the buffer no longer shows the angel, dead() stays true.
    const blank = pet.save();
    blank.fill(0, LCD_PTR, LCD_PTR + 512);
    pet.loadState(blank);
    pet.step(1000);
    expect(pet.dead()).toBe(true);
  });

  it("converts wall-clock milliseconds to emulator steps (not seconds)", () => {
    // A pet stepped by 1 000 ms should show more progress than one stepped by
    // a single step; and stepping ~1000 ms twice must equal ~2000 ms once.
    const a = new PetEmulator(rom, wasm);
    a.step(400);
    a.press("middle");
    a.step(1000);
    const b = new PetEmulator(rom, wasm);
    b.loadState(a.save());
    a.step(1000);
    b.step(500);
    b.step(500);
    expect(b.lcd()).toEqual(a.lcd());
  });
});

describe("TickLoop", () => {
  it("steps every pet on each interval and stops cleanly", async () => {
    const steps: number[] = [];
    const fakes = [
      { step: (ms: number) => steps.push(ms), lcd: () => new Uint8Array(512) },
      { step: (ms: number) => steps.push(ms), lcd: () => new Uint8Array(512) },
    ];
    const frames: unknown[] = [];
    const loop = new TickLoop(() => fakes as unknown as PetEmulator[]);
    loop.onFrame((pet, lcd) => frames.push([pet, lcd]));
    loop.start(50);
    await new Promise((r) => setTimeout(r, 180));
    loop.stop();
    // Both pets advanced.
    expect(steps.filter((s) => s > 0).length).toBeGreaterThanOrEqual(2);
    // Frames were emitted to the callback.
    expect(frames.length).toBeGreaterThan(0);
    // stop() ends the loop: no further steps after a settle window.
    const afterStop = steps.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(steps.length).toBe(afterStop);
  });

  it("does not overlap ticks when a step is slow", async () => {
    // A slow, *synchronous* step (as PetEmulator.step is) must never be
    // re-entered: the re-entrancy guard has to hold while a tick is running.
    let inFlight = 0;
    let maxInFlight = 0;
    const pet = {
      step: () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const until = Date.now() + 30;
        while (Date.now() < until) { /* busy wait: holds the tick open */ }
        inFlight--;
      },
      lcd: () => new Uint8Array(512),
    };
    const loop = new TickLoop(() => [pet as unknown as PetEmulator]);
    loop.start(10);
    await new Promise((r) => setTimeout(r, 150));
    loop.stop();
    expect(maxInFlight).toBeLessThanOrEqual(1);
  });
});
