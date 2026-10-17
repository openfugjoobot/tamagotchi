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
import { TS_PER_STEP } from "../../src/emu/constants.js";

export const LCD_WIDTH = 32;
export const LCD_HEIGHT = 16;
export const ICON_COUNT = 8;

/** Buttons A=left, B=middle, C=right (same mapping as the browser wrapper). */
export type Btn = "left" | "middle" | "right";
const BTN_INDEX: Record<Btn, number> = { left: 0, middle: 1, right: 2 };

/**
 * Number of CPU steps implied by a wall-clock duration in milliseconds.
 *
 * Pure real-time conversion, kept as a public helper/tests convenience. It is no
 * longer a time *path* on its own: `step(ms)` is the only place emulated time is
 * granted (it uses `unitsForMs` so the remainder carries), and `press()` mints
 * nothing. Exposing it here would let a caller re-introduce the old "press runs
 * its own steps" bug by accident — so the invariant is: buttons never call it.
 */
export function stepsForMs(ms: number): number {
  if (!(ms > 0)) return 0;
  // Emulator time stamp units are 1/32768 s; calibrated ~TS_PER_STEP per step.
  const units = (ms * 32768) / 1000;
  return Math.max(1, Math.round(units / TS_PER_STEP));
}

/** Emulator stamp units for a real duration in milliseconds (1 unit = 1/32768 s). */
function unitsForMs(ms: number): number {
  return (ms * 32768) / 1000;
}

/**
 * How long a button is held down, in **real** milliseconds, so the firmware has
 * a frame to sample it. This is a duration of *input*, not a source of time:
 * the hold is paid out of the emulated time real elapsed time already owed, so
 * the game clock still only follows the wall clock (see `step()`).
 *
 * 400 ms matches the firmware's requirement: the P1 clock-set / menu taps are
 * only sampled when the button is held this long (verified against the real ROM
 * — a 100 ms hold never registers a clock-set press, 400 ms does). It is the
 * same duration the old pre-fix `press()` used, just paid from real time instead
 * of minted on the spot.
 */
export const PRESS_HOLD_MS = 400;

/**
 * Button-up gap, in **real** milliseconds, enforced between two consecutive
 * queued presses. Without it a burst of clicks could read as one continuous
 * hold and the firmware would see a single edge; a 400 ms released window makes
 * each click a distinct down→up, matching the old release half of a press. Like
 * the hold itself, the gap is paid out of the owed real-time budget — it adds no
 * time of its own.
 */
export const PRESS_GAP_MS = 400;

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
  /** Total CPU steps executed since construction (diagnostics/tests). */
  private stepsRun = 0;
  /**
   * Button presses waiting to be materialised by `step()`, in arrival order.
   * Each click must be observed on its own, so they queue rather than coalesce;
   * the queue drains as real time (the owed budget) becomes available.
   */
  private queue: Btn[] = [];
  /** The button currently being held down while it is materialised. */
  private activeBtn: Btn | null = null;
  /** Emulator units left before the active hold releases (1/32768 s). */
  private holdUnitsLeft = 0;
  /** Emulator units left in the button-up gap before the next queued press. */
  private gapUnitsLeft = 0;

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
   * Advance the pet by a wall-clock duration in milliseconds. This is the **only**
   * way emulated time is created: `ms` is real elapsed time handed in by the tick
   * loop (or the offline catch-up), and never anything a button contributed.
   *
   * Queued button presses (see `press`) are materialised *inside* this call:
   * each click is played out as a short down→up hold, with a small released gap
   * between consecutive clicks, so the firmware observes every press as distinct
   * input. All of that is paid out of the owed budget `ms` just added — the hold
   * and gap consume time that the wall clock already granted, so N clicks can
   * never advance the clock further than the wall clock did. A press whose hold
   * is not fully paid within this call simply continues on the next `step()`.
   *
   * Whatever the segmentation, the total steps run are exactly
   * `floor(Σ unitsForMs(ms) / TS_PER_STEP)`: buttons change *when* the CPU runs,
   * never *how much*. Fractional-step remainders are carried over, so many small
   * calls sum to the same result as one large call.
   */
  step(ms: number): void {
    if (!(ms > 0)) return;
    // Accumulate emulator time in stamp units (1/32768 s).
    this.pending += unitsForMs(ms);

    // Walk the owed budget, splitting it at the input edges so the pin is
    // actually in the right state while the ROM runs each stretch of steps.
    while (this.pending >= TS_PER_STEP) {
      if (this.activeBtn !== null && this.holdUnitsLeft > 0) {
        // Down segment: run steps until the hold is paid out (or the budget runs
        // dry), with the button asserted.
        const steps = Math.min(
          Math.floor(this.holdUnitsLeft / TS_PER_STEP),
          Math.floor(this.pending / TS_PER_STEP),
        );
        if (steps <= 0) {
          // Sub-step of hold left: finish the hold without touching `pending`,
          // so the full owed budget still converts to the same step count as an
          // unpressed pet. The button-up gap (or the next press) follows.
          this.endHold();
          continue;
        }
        this.setPin(this.activeBtn, true);
        this.run(steps);
        const spent = steps * TS_PER_STEP;
        this.pending -= spent;
        this.holdUnitsLeft -= spent;
        if (this.holdUnitsLeft <= 0) this.endHold();
      } else if (this.gapUnitsLeft > 0) {
        // Released gap between two queued clicks: keep the pin up.
        const steps = Math.min(
          Math.floor(this.gapUnitsLeft / TS_PER_STEP),
          Math.floor(this.pending / TS_PER_STEP),
        );
        if (steps <= 0) {
          this.gapUnitsLeft = 0;
          continue;
        }
        this.run(steps);
        const spent = steps * TS_PER_STEP;
        this.pending -= spent;
        this.gapUnitsLeft -= spent;
      } else if (this.queue.length > 0) {
        // Start the next click's hold (materialised on the following pass).
        this.activeBtn = this.queue.shift() as Btn;
        this.holdUnitsLeft = unitsForMs(PRESS_HOLD_MS);
      } else {
        // Idle: the whole remaining budget is button-up.
        const steps = Math.floor(this.pending / TS_PER_STEP);
        this.pending -= steps * TS_PER_STEP;
        this.run(steps);
      }
    }
    this.checkDead();
  }

  /** Run `n` CPU steps and account for them. */
  private run(n: number): void {
    if (n <= 0) return;
    this.ex.emu_step_n(n);
    this.stepsRun += n;
  }

  /** Finish a hold: release the pin and set up the inter-press gap. */
  private endHold(): void {
    if (this.activeBtn !== null) this.setPin(this.activeBtn, false);
    this.activeBtn = null;
    this.holdUnitsLeft = 0;
    // Only pay a released gap when another click is actually waiting.
    if (this.queue.length > 0) this.gapUnitsLeft = unitsForMs(PRESS_GAP_MS);
    else this.gapUnitsLeft = 0;
  }

  /** Assert or release a specific button's pin. */
  private setPin(btn: Btn, down: boolean): void {
    this.ex.emu_set_button(BTN_INDEX[btn], down ? 1 : 0);
  }

  /** Current 32x16 LCD frame (live view into WASM memory). */
  lcd(): Uint8Array {
    this.refresh();
    return this.mem.subarray(this.lcdPtr, this.lcdPtr + LCD_WIDTH * LCD_HEIGHT);
  }

  /**
   * The 8 icon-segment bits (0/1) from the LCD driver, live view into WASM
   * memory. These are the P1 menu/status segments the ROM drives through
   * `hw_set_lcd_pin` (seg 8/28); the frame protocol carries them so the client
   * can draw the top/bottom icon rows. On the shipped P1 ROM no segment is
   * currently driven (the printed icons are not ROM segments), so this reads
   * all-zero for a live P1 pet — but the bits are real, not hardcoded, and a
   * future ROM/device that drives them lights up with no protocol change.
   */
  icons(): Uint8Array {
    this.refresh();
    return this.mem.subarray(this.iconsPtr, this.iconsPtr + ICON_COUNT);
  }

  /**
   * Press a button. This is an **input event, never a time event**: it enqueues
   * the press and returns immediately without advancing the emulator clock or
   * running any CPU steps. The click is materialised by later `step()` calls —
   * the tick loop's real time — so pressing a button cannot make the game clock
   * run faster than the wall clock, no matter how often it is clicked.
   *
   * Presses are queued in arrival order (never coalesced), so a fast sequence
   * like the clock-set tap dance reaches the firmware as distinct edges even when
   * several clicks land within one tick. The caller passes the logical button
   * name (A=left, B=middle, C=right).
   */
  press(btn: Btn): void {
    this.queue.push(btn);
  }

  /** Number of queued presses not yet materialised. */
  pendingPresses(): number {
    return this.queue.length + (this.activeBtn !== null ? 1 : 0);
  }

  /** True while a button hold is still waiting to be materialised by `step()`. */
  buttonHeld(): boolean {
    return this.activeBtn !== null && this.holdUnitsLeft > 0;
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

  /**
   * Total CPU steps executed since construction. This is the honest measure of
   * how much *emulated time* the pet has been granted: it must be a pure
   * function of the summed real `step(ms)` durations, never of button presses.
   */
  steps(): number {
    return this.stepsRun;
  }

  /** Emulator time stamp (u32, wraps). Exposed for diagnostics/tests. */
  now(): number {
    return this.ex.emu_now();
  }

  /** Consume the beep latch: true if the ROM fired the buzzer since last read. */
  takeBuzzer(): boolean {
    return this.ex.emu_take_buzzer() !== 0;
  }

  /**
   * Current piezo state, for streaming the live beep to a watching client.
   *
   * `freq` is the raw HAL-glue frequency (`emu_freq()`); `on` is the piezo
   * enable flag (`emu_en()`). This is the exact mapping the old in-tab emulator
   * exposed (`{freq: emu_freq(), on: emu_en() !== 0}`, git f99149c) and fed
   * straight into `src/emu/audio.ts`, so the server must NOT rescale it — the
   * client keeps its own conversion (it divides before the oscillator). Unlike
   * `takeBuzzer()` (a latch that is consumed, used for the debounced push) this
   * is a *level*, so the hub can diff it and only emit on change. Values are
   * read straight from the HAL glue (`emu/src/glue.c`).
   */
  buzzer(): { freq: number; on: boolean } {
    return { freq: this.ex.emu_freq(), on: this.ex.emu_en() !== 0 };
  }
}
