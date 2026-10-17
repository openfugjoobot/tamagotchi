/**
 * One tick loop for all pets.
 *
 * A single interval drives every live pet: on each tick it steps each pet by
 * the real elapsed time since the previous tick and emits the resulting LCD
 * frame. Keeping one loop (rather than a timer per pet) means the clock stays
 * consistent across pets and the cost scales with tick rate, not pet count.
 *
 * Failure isolation: a pet's `step()` runs inside `try/catch`, so one throwing
 * pet can never escape the interval as an uncaught exception (which would kill
 * the process and with it every other pet). The error is reported to `onError`
 * hooks and the loop carries on with the remaining pets. The same guard wraps
 * the frame callbacks — a bad subscriber must not take the server down either.
 *
 * Injectable: the pet source is a callback, so a test can hand over fake pets
 * and observe the loop without any WASM.
 */
import { PetEmulator } from "./emulator.js";

/** The slice of `PetEmulator` the loop needs — lets tests pass fakes. */
export interface PetLike {
  step(ms: number): void;
  lcd(): Uint8Array;
}

export type PetSource = () => PetLike[];
export type FrameCallback = (pet: PetLike, lcd: Uint8Array) => void;
/** Called when a pet's step or a frame callback throws. */
export type ErrorCallback = (pet: PetLike, err: unknown) => void;
/** Called once after all pets have been stepped in a tick. */
export type TickEndCallback = () => void;

export class TickLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastAt = 0;
  private frameCbs: FrameCallback[] = [];
  private errorCbs: ErrorCallback[] = [];
  private tickEndCbs: TickEndCallback[] = [];
  private ticking = false;

  constructor(private readonly pets: PetSource) {}

  /** Register a callback invoked with each pet and its fresh LCD frame. */
  onFrame(cb: FrameCallback): void {
    this.frameCbs.push(cb);
  }

  /**
   * Register an error hook. Called (not thrown) when a pet's step or a frame
   * callback throws, so the loop keeps running and the failure is observable.
   */
  onError(cb: ErrorCallback): void {
    this.errorCbs.push(cb);
  }

  /**
   * Register a hook run once after every pet has been stepped. Callbacks that
   * need the whole tick's worth of work (e.g. "push changed frames to clients")
   * belong here rather than in `onFrame`, which fires once per pet.
   */
  onTickEnd(cb: TickEndCallback): void {
    this.tickEndCbs.push(cb);
  }

  /**
   * Start the loop at `intervalMs`. Each tick advances every pet by the real
   * time elapsed since the previous tick, so drift does not accumulate.
   */
  start(intervalMs: number): void {
    if (this.timer !== null) return;
    this.lastAt = Date.now();
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  /** Stop the loop. Safe to call when not running. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One tick: advance every pet and emit its frame. No overlapping ticks. */
  private tick(): void {
    if (this.ticking) return;
    this.ticking = true;
    const now = Date.now();
    const dt = Math.max(0, now - this.lastAt);
    this.lastAt = now;
    try {
      for (const pet of this.pets()) {
        // Per-pet isolation (Task-3 F1): a throwing step must not escape the
        // interval as an uncaught exception and kill the whole process.
        try {
          pet.step(dt);
        } catch (err) {
          this.reportError(pet, err);
          continue;
        }
        let lcd: Uint8Array;
        try {
          lcd = pet.lcd().slice();
        } catch (err) {
          this.reportError(pet, err);
          continue;
        }
        for (const cb of this.frameCbs) {
          try {
            cb(pet, lcd);
          } catch (err) {
            this.reportError(pet, err);
          }
        }
      }
      for (const cb of this.tickEndCbs) {
        try {
          cb();
        } catch (err) {
          this.reportError(undefined, err);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private reportError(pet: PetLike | undefined, err: unknown): void {
    for (const cb of this.errorCbs) {
      try {
        cb(pet as PetLike, err);
      } catch {
        // An error hook that itself throws must not break the loop either.
      }
    }
  }
}

/** Kept so `TickLoop` callers still see the concrete pet type. */
export type { PetEmulator };
