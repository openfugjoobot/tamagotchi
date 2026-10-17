/**
 * Server-side pet emulator: the same TamaLIB WASM core the browser used to run,
 * now embedded in Node. One instance per pet, each with its own linear memory.
 *
 * The wrapper mirrors `src/emu/emulator.ts` (same exports, same memory-view
 * rebinding) but drives time from wall-clock milliseconds: `step(ms)` converts
 * a real duration into the CPU steps the emulator must run. This is the server
 * owning the clock — no `setInterval` on the device, no `?speed=`.
 *
 * `dead()` is latched: once the angel frame has been seen it stays true, since
 * the death image can flicker (stars animate) and a pet never comes back.
 */
// Runtime-resolvable relative specifiers, NOT the `@/emu/*` alias: the alias is
// known only to vitest + tsconfig, so a plain `node dist-server/server/src/main.js`
// run would die with ERR_MODULE_NOT_FOUND on the first import (Task-3 F2). The `.js`
// suffix is the ESM-correct specifier for the emitted file; vitest and `tsc`
// both resolve `death.js` back to `death.ts`.
import { isAngelFrame } from "../../src/emu/death.js";
import { TS_PER_STEP } from "../../src/emu/clock.js";

export const LCD_WIDTH = 32;
export const LCD_HEIGHT = 16;
export const ICON_COUNT = 8;

/** Buttons A=left, B=middle, C=right (same mapping as the browser wrapper). */
export type Btn = "left" | "middle" | "right";
const BTN_INDEX: Record<Btn, number> = { left: 0, middle: 1, right: 2 };

/** Number of CPU steps implied by a wall-clock duration in milliseconds. */
export function stepsForMs(ms: number): number {
  if (!(ms > 0)) return 0;
  // Emulator time stamp units are 1/32768 s; calibrated ~TS_PER_STEP per step.
  const units = (ms * 32768) / 1000;
  return Math.max(1, Math.round(units / TS_PER_STEP));
}

interface RawExports {
  memory: WebAssembly.Memory;
  emu_rom_byte(i: number, v: number): void;
  emu_init(): void;
  emu_step(): void;
  emu_step_n(n: number): void;
  emu_set_button(btn: number, state: number): void;
  emu_lcd(): number;
  emu_icons(): number;
  emu_freq(): number;
  emu_en(): number;
  emu_take_buzzer(): number;
  emu_now(): number;
}

/**
 * A single pet's emulator. Construction is synchronous: unlike the browser
 * path there is no `fetch` to await, so callers can build a pet inline.
 */
export class PetEmulator {
  private ex: RawExports;
  private mem: Uint8Array;
  private lcdPtr: number;
  private iconsPtr: number;
  private deadLatch = false;
  /** Leftover emulator time (in units of 1/32768 s) not yet run. */
  private pending = 0;

  constructor(rom: Uint8Array, wasm: Uint8Array | ArrayBuffer, state?: Uint8Array) {
    const module = new WebAssembly.Module(wasm as BufferSource);
    const instance = new WebAssembly.Instance(module, {});
    this.ex = instance.exports as unknown as RawExports;
    for (let i = 0; i < rom.length; i++) this.ex.emu_rom_byte(i, rom[i]);
    this.ex.emu_init();
    this.lcdPtr = this.ex.emu_lcd();
    this.iconsPtr = this.ex.emu_icons();
    this.mem = new Uint8Array(this.ex.memory.buffer);
    if (state) this.loadState(state);
  }

  /** Rebind the memory view after a possible `memory.grow`. */
  private refresh(): void {
    if (this.mem.buffer !== this.ex.memory.buffer) this.mem = new Uint8Array(this.ex.memory.buffer);
  }

  /**
   * Advance the pet by a wall-clock duration in milliseconds. Fractional-step
   * remainders are carried over, so many small calls sum to the same result as
   * one large call.
   */
  step(ms: number): void {
    if (!(ms > 0)) return;
    // Accumulate emulator time in stamp units (1/32768 s), then convert the
    // whole budget to steps. The sub-step remainder carries over, so many
    // small calls sum to the same result as one large call.
    this.pending += (ms * 32768) / 1000;
    const steps = Math.floor(this.pending / TS_PER_STEP);
    if (steps <= 0) return;
    this.pending -= steps * TS_PER_STEP;
    this.ex.emu_step_n(steps);
    this.checkDead();
  }

  /** Current 32x16 LCD frame (live view into WASM memory). */
  lcd(): Uint8Array {
    this.refresh();
    return this.mem.subarray(this.lcdPtr, this.lcdPtr + LCD_WIDTH * LCD_HEIGHT);
  }

  /** Icon buffer (P1 exposes none; kept for parity with the browser wrapper). */
  icons(): Uint8Array {
    this.refresh();
    return this.mem.subarray(this.iconsPtr, this.iconsPtr + ICON_COUNT);
  }

  /**
   * Press a button. A full press is a down/up cycle, matching how the ROM
   * expects input; the caller passes the logical button name.
   */
  press(btn: Btn): void {
    const idx = BTN_INDEX[btn];
    this.ex.emu_set_button(idx, 1);
    this.ex.emu_step_n(stepsForMs(400));
    this.ex.emu_set_button(idx, 0);
    this.ex.emu_step_n(stepsForMs(400));
    this.checkDead();
  }

  /** Full snapshot of the WASM linear memory (the pet's saved state). */
  save(): Uint8Array {
    this.refresh();
    return this.mem.slice();
  }

  /** Restore a previously saved state into this instance. */
  loadState(buf: Uint8Array): void {
    this.refresh();
    if (buf.length !== this.mem.length) {
      throw new Error(`state size mismatch: ${buf.length} != ${this.mem.length}`);
    }
    this.mem.set(buf);
    this.checkDead();
  }

  /** Latch the death flag if the current frame shows the angel. */
  private checkDead(): void {
    if (!this.deadLatch && isAngelFrame(this.lcd())) this.deadLatch = true;
  }

  /** True once the angel (death) frame has ever been observed. Latched. */
  dead(): boolean {
    this.checkDead();
    return this.deadLatch;
  }

  /** Emulator time stamp (u32, wraps). Exposed for diagnostics/tests. */
  now(): number {
    return this.ex.emu_now();
  }

  /** Consume the beep latch: true if the ROM fired the buzzer since last read. */
  takeBuzzer(): boolean {
    return this.ex.emu_take_buzzer() !== 0;
  }
}
