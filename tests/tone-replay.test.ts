import { describe, it, expect, vi } from "vitest";
import { planTones, ToneReplayer, type ToneSink } from "@/emu/tone-replay";
import type { ToneEventLike } from "@/emu/tone-replay";

// Der Replayer macht aus dem verlustfreien Emulator-Zeitstempel-Strom
// (`{at,freq,play}` in µs) Wanduhr-Verzögerungen und treibt damit den Piezo.
// Getestet wird die reine Zeitrechnung (`planTones`) und die Timer-Planung —
// ohne Browser, ohne echte `setTimeout`-Wartezeit (injizierte Uhr).

const chirp: ToneEventLike[] = [
  { at: 1000, freq: 27307, play: false }, // freq-off
  { at: 1015, freq: 27307, play: true }, // Blip an
  { at: 2715, freq: 27307, play: false }, // Blip aus
  { at: 4624, freq: 23406, play: false }, // freq-off
  { at: 4639, freq: 23406, play: true }, // Ton an
  { at: 11829, freq: 23406, play: false }, // Ton aus
];

describe("planTones", () => {
  it("anchors the first event at 0 and converts µs deltas to ms", () => {
    const plan = planTones(chirp);
    expect(plan[0]).toEqual({ delayMs: 0, freq: 27307, play: false });
    expect(plan[1].delayMs).toBeCloseTo(0.015, 6);
    expect(plan[2].delayMs).toBeCloseTo(1.715, 6);
    expect(plan[3].delayMs).toBeCloseTo(3.624, 6);
    expect(plan[4].delayMs).toBeCloseTo(3.639, 6);
    expect(plan[5].delayMs).toBeCloseTo(10.829, 6);
  });

  it("preserves order and the two-tone chirp shape", () => {
    const plan = planTones(chirp);
    expect(plan.map((p) => p.freq)).toEqual([27307, 27307, 27307, 23406, 23406, 23406]);
    expect(plan.map((p) => p.play)).toEqual([false, true, false, false, true, false]);
    // Delays never decrease.
    for (let i = 1; i < plan.length; i++) expect(plan[i].delayMs).toBeGreaterThanOrEqual(plan[i - 1].delayMs);
  });

  it("clamps a non-positive or non-finite delta to 0", () => {
    const plan = planTones([
      { at: 1000, freq: 1, play: true },
      { at: 1000, freq: 1, play: false }, // equal stamp -> 0
      { at: Number.NaN, freq: 1, play: true }, // NaN -> 0
    ]);
    expect(plan.map((p) => p.delayMs)).toEqual([0, 0, 0]);
  });

  it("returns nothing for an empty batch", () => {
    expect(planTones([])).toEqual([]);
  });
});

describe("ToneReplayer", () => {
  /** A sink that records every update, plus an injectable fake clock. */
  function makeHarness(): {
    sink: ToneSink;
    updates: Array<{ freq: number; on: boolean }>;
    scheduled: Array<{ delayMs: number; fire: () => void }>;
    replayer: ToneReplayer;
  } {
    const updates: Array<{ freq: number; on: boolean }> = [];
    const sink: ToneSink = { update: (freq, on) => updates.push({ freq, on }) };
    const scheduled: Array<{ delayMs: number; fire: () => void }> = [];
    const live = new Set<number>();
    let next = 1;
    const replayer = new ToneReplayer({
      sink,
      schedule: (fn, delayMs) => {
        const h = next++;
        live.add(h);
        scheduled.push({
          delayMs,
          // A real timer does not fire after clearTimeout; mirror that so the
          // test can prove cancellation actually stops a transition.
          fire: () => {
            if (live.has(h)) fn();
          },
        });
        return h;
      },
      cancel: (h) => {
        live.delete(h);
      },
      now: () => 42_000,
    });
    return { sink, updates, scheduled, replayer };
  }

  it("plays the first event immediately and schedules the rest by their deltas", () => {
    const { updates, scheduled, replayer } = makeHarness();
    replayer.play(chirp);
    // First event (delay 0) fires synchronously.
    expect(updates).toEqual([{ freq: 27307, on: false }]);
    // The other five are planned, in order, with the correct delays.
    expect(scheduled.map((s) => s.delayMs)).toEqual([
      expect.closeTo(0.015, 6),
      expect.closeTo(1.715, 6),
      expect.closeTo(3.624, 6),
      expect.closeTo(3.639, 6),
      expect.closeTo(10.829, 6),
    ]);
    expect(replayer.pendingCount()).toBe(5);
  });

  it("fires the scheduled transitions in order when their timers run", () => {
    const { updates, scheduled, replayer } = makeHarness();
    replayer.play(chirp);
    for (const s of scheduled) s.fire();
    expect(updates).toEqual([
      { freq: 27307, on: false },
      { freq: 27307, on: true },
      { freq: 27307, on: false },
      { freq: 23406, on: false },
      { freq: 23406, on: true },
      { freq: 23406, on: false },
    ]);
    expect(replayer.pendingCount()).toBe(0);
  });

  it("cancels the previous batch when a newer one arrives", () => {
    const { updates, scheduled, replayer } = makeHarness();
    replayer.play(chirp);
    expect(replayer.pendingCount()).toBe(5);
    // A new batch supersedes the old plan.
    replayer.play([{ at: 20000, freq: 23406, play: true }]);
    expect(replayer.pendingCount()).toBe(0);
    // Nothing from the first batch can fire any more.
    for (const s of scheduled) s.fire();
    expect(updates).toEqual([
      { freq: 27307, on: false }, // first event of batch 1 (immediate)
      { freq: 23406, on: true }, // batch 2's only event (immediate)
    ]);
  });

  it("stop() cancels everything and schedules no further transition", () => {
    const { updates, scheduled, replayer } = makeHarness();
    replayer.play(chirp);
    replayer.stop();
    expect(replayer.pendingCount()).toBe(0);
    for (const s of scheduled) s.fire();
    // Only the immediate first event played before stop().
    expect(updates).toEqual([{ freq: 27307, on: false }]);
  });

  it("uses real setTimeout by default for a delayed event", () => {
    vi.useFakeTimers();
    try {
      const updates: Array<{ freq: number; on: boolean }> = [];
      const replayer = new ToneReplayer({ sink: { update: (freq, on) => updates.push({ freq, on }) } });
      replayer.play([
        { at: 0, freq: 100, play: true },
        { at: 5000, freq: 100, play: false }, // 5 ms later
      ]);
      expect(updates).toEqual([{ freq: 100, on: true }]);
      vi.advanceTimersByTime(5);
      expect(updates).toEqual([
        { freq: 100, on: true },
        { freq: 100, on: false },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
