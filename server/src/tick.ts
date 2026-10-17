/**
 * One tick loop for all pets.
 *
 * A single interval drives every live pet: on each tick it steps each pet by
 * the real elapsed time since the previous tick and emits the resulting LCD
 * frame. Keeping one loop (rather than a timer per pet) means the clock stays
 * consistent across pets and the cost scales with tick rate, not pet count.
 *
 * Injectable: the pet source is a callback, so a test can hand over fake pets
 * and observe the loop without any WASM.
 */
import { PetEmulator } from "./emulator";

export type PetSource = () => PetEmulator[];
export type FrameCallback = (pet: PetEmulator, lcd: Uint8Array) => void;

export class TickLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastAt = 0;
  private frameCbs: FrameCallback[] = [];
  private ticking = false;

  constructor(private readonly pets: PetSource) {}

  /** Register a callback invoked with each pet and its fresh LCD frame. */
  onFrame(cb: FrameCallback): void {
    this.frameCbs.push(cb);
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
        pet.step(dt);
        const lcd = pet.lcd().slice();
        for (const cb of this.frameCbs) cb(pet, lcd);
      }
    } finally {
      this.ticking = false;
    }
  }
}
