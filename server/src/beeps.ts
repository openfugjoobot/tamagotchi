/**
 * Generic beep events — debounced.
 *
 * The ROM beeps for many reasons, and the reason cannot be read back out of it.
 * So we only ever record *that* a pet beeped (schema §3: `beeps` has no `kind`),
 * never why. That is a deliberate product decision (Ivan, 2026-10-17, spec §4),
 * and it is why nothing in this file or downstream guesses a cause.
 *
 * Signal. The emulator exposes a *latch* (`emu_take_buzzer()`): reading it
 * returns true once per piezo burst and clears it. Task 2 measured the latch
 * over two simulated days (`docs/BEEPS.md`): it fires in clusters of 8–14 chirps
 * with a quiet gap of ≥ 114 s between clusters, and it goes permanently silent
 * at death. A per-pet debounce of `DEBOUNCE_MS = 60_000` therefore collapses one
 * attention burst into a single event without ever swallowing two distinct ones.
 *
 * Wiring. `collectBeep` is called once per pet per tick with the latch result.
 * It owns the debounce clock, keyed by pet id, and writes a `beeps` row when the
 * burst is new. The row starts with `notified_at = NULL`; the push sweeper
 * (`push.ts`) is what flips it.
 */

/**
 * Debounce window per pet. 60 s is the measured-safe window (Task 2 / BEEPS.md):
 * distinct attention bursts are ≥ 114 s apart, so this cannot merge them.
 */
export const DEBOUNCE_MS = 60_000;

/** The only repo method beep collection needs. Keeps it injectable in tests. */
export interface BeepSink {
  recordBeep(petId: string): Promise<unknown>;
}

/** Last time each pet produced a beep event (in the caller's clock). */
const lastBeepAt = new Map<string, number>();

/**
 * Record a beep if the latch fired and the pet is past its debounce window.
 *
 * `nowMs` is passed in rather than read from `Date.now()` so the debounce is
 * deterministic in tests and consistent with the tick loop's own clock.
 * Returns true when a row was written.
 */
export async function collectBeep(
  sink: BeepSink,
  petId: string,
  latched: boolean,
  nowMs: number,
): Promise<boolean> {
  if (!latched) return false;

  const last = lastBeepAt.get(petId);
  if (last !== undefined && nowMs - last < DEBOUNCE_MS) return false;

  lastBeepAt.set(petId, nowMs);
  await sink.recordBeep(petId);
  return true;
}

/**
 * Forget a pet's debounce state. Called when a pet is destroyed so the map does
 * not grow without bound across a long-running server.
 */
export function forgetPet(petId: string): void {
  lastBeepAt.delete(petId);
}

/** Test/diagnostic hook: clear all debounce state. */
export function resetBeepDebounce(): void {
  lastBeepAt.clear();
}
