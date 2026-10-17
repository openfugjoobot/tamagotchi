import { describe, it, expect } from "vitest";
import { planTones, planTonesAt, ToneReplayer, type ToneSink } from "@/emu/tone-replay";
import type { ToneEventLike } from "@/emu/tone-replay";

// Der Replayer legt den verlustfreien Emulator-Zeitstempel-Strom
// (`{at,freq,play}` in µs) auf die WebAudio-Uhr (`ctx.currentTime`): jedes
// Ereignis bekommt eine ABSOLUTE AudioContext-Zeit `at0Sec + (at - at0)/1e6`.
// Getestet wird die reine Rechnung (`planTones`/`planTonesAt`) und die
// Planung/Verwerfung durch den Replayer — DOM-frei, ohne echte Wartezeit.

const chirp: ToneEventLike[] = [
  { at: 1000, freq: 27307, play: false }, // freq-off
  { at: 1015, freq: 27307, play: true }, // Blip an
  { at: 2715, freq: 27307, play: false }, // Blip aus
  { at: 4624, freq: 23406, play: false }, // freq-off
  { at: 4639, freq: 23406, play: true }, // Ton an
  { at: 11829, freq: 23406, play: false }, // Ton aus
];

describe("planTonesAt", () => {
  const AT0_SEC = 5.0; // der Batch-Anker auf der AudioContext-Uhr

  it("anchors the first event exactly at at0 and converts µs deltas to seconds", () => {
    const plan = planTonesAt(chirp, AT0_SEC);
    expect(plan[0]).toEqual({ atSec: 5.0, freq: 27307, play: false });
    expect(plan[1].atSec).toBeCloseTo(5.000015, 9); // 15 µs
    expect(plan[2].atSec).toBeCloseTo(5.001715, 9); // 1.715 ms
    expect(plan[3].atSec).toBeCloseTo(5.003624, 9); // 3.624 ms
    expect(plan[4].atSec).toBeCloseTo(5.003639, 9); // 3.639 ms
    expect(plan[5].atSec).toBeCloseTo(5.010829, 9); // 10.829 ms
  });

  it("preserves order and the two-tone chirp shape", () => {
    const plan = planTonesAt(chirp, AT0_SEC);
    expect(plan.map((p) => p.freq)).toEqual([27307, 27307, 27307, 23406, 23406, 23406]);
    expect(plan.map((p) => p.play)).toEqual([false, true, false, false, true, false]);
    // Absolute times never decrease.
    for (let i = 1; i < plan.length; i++) expect(plan[i].atSec).toBeGreaterThanOrEqual(plan[i - 1].atSec);
  });

  it("clamps a non-positive or non-finite delta onto the anchor", () => {
    const plan = planTonesAt(
      [
        { at: 1000, freq: 1, play: true },
        { at: 1000, freq: 1, play: false }, // equal stamp -> anchor
        { at: Number.NaN, freq: 1, play: true }, // NaN -> anchor
      ],
      AT0_SEC,
    );
    expect(plan.map((p) => p.atSec)).toEqual([AT0_SEC, AT0_SEC, AT0_SEC]);
  });

  it("returns nothing for an empty batch", () => {
    expect(planTonesAt([], AT0_SEC)).toEqual([]);
  });
});

describe("planTones (relative ms deltas)", () => {
  it("anchors the first event at 0 and converts µs deltas to ms", () => {
    const plan = planTones(chirp);
    expect(plan[0]).toEqual({ delayMs: 0, freq: 27307, play: false });
    expect(plan[1].delayMs).toBeCloseTo(0.015, 6);
    expect(plan[2].delayMs).toBeCloseTo(1.715, 6);
    expect(plan[3].delayMs).toBeCloseTo(3.624, 6);
    expect(plan[4].delayMs).toBeCloseTo(3.639, 6);
    expect(plan[5].delayMs).toBeCloseTo(10.829, 6);
  });

  it("clamps a non-positive or non-finite delta to 0", () => {
    const plan = planTones([
      { at: 1000, freq: 1, play: true },
      { at: 1000, freq: 1, play: false },
      { at: Number.NaN, freq: 1, play: true },
    ]);
    expect(plan.map((p) => p.delayMs)).toEqual([0, 0, 0]);
  });

  it("returns nothing for an empty batch", () => {
    expect(planTones([])).toEqual([]);
  });
});

describe("ToneReplayer", () => {
  /**
   * Ein Sink, der jede Transition **zeitgestempelt** aufzeichnet, plus eine
   * injizierbare AudioContext-Uhr. Die Uhr treibt eine Makro-Task-Queue, damit
   * der Test die Planung deterministisch beobachten kann, ohne echte Zeit zu
   * verbrauchen.
   */
  function makeHarness(opts: { clockStart?: number } = {}) {
    const updates: Array<{ freq: number; on: boolean; atSec: number }> = [];
    const sink: ToneSink = { update: (freq, on, when) => updates.push({ freq, on, atSec: when }) };
    let clock = opts.clockStart ?? 0; // ctx.currentTime in Sekunden
    const scheduled: Array<{ atSec: number; fire: () => void }> = [];
    const live = new Map<number, () => void>();
    let next = 1;
    /** Lässt die Uhr bis `targetSec` laufen und führt fällige Timer in Zeitordnung aus. */
    const advanceTo = (targetSec: number): void => {
      clock = targetSec;
      for (;;) {
        const due = scheduled.filter((s) => s.atSec <= targetSec).sort((a, b) => a.atSec - b.atSec);
        if (due.length === 0) break;
        const nextDue = due[0];
        const idx = scheduled.indexOf(nextDue);
        scheduled.splice(idx, 1);
        nextDue.fire();
      }
    };
    const replayer = new ToneReplayer({
      sink,
      nowSec: () => clock,
      schedule: (fn: () => void, atSec: number) => {
        const h = next++;
        const wrapped = () => {
          if (!live.has(h)) return; // storniert
          live.delete(h);
          clock = Math.max(clock, atSec);
          fn();
        };
        live.set(h, wrapped);
        scheduled.push({ atSec, fire: wrapped });
        return h;
      },
      cancel: (h) => {
        live.delete(h);
      },
    });
    return { sink, updates, scheduled, replayer, advanceTo, clock: () => clock, live };
  }

  it("plays the first event immediately, at the audio clock's now", () => {
    const h = makeHarness({ clockStart: 5.0 });
    h.replayer.play(chirp);
    expect(h.updates).toEqual([{ freq: 27307, on: false, atSec: 5.0 }]);
  });

  it("schedules the rest at absolute ctx.currentTime positions, not relative timers", () => {
    const h = makeHarness({ clockStart: 5.0 });
    h.replayer.play(chirp);
    expect(h.scheduled.map((s) => s.atSec)).toEqual([
      5.000015, 5.001715, 5.003624, 5.003639, 5.010829,
    ]);
  });

  it("fires each scheduled transition with its own absolute time (sample-accurate)", () => {
    const h = makeHarness({ clockStart: 5.0 });
    h.replayer.play(chirp);
    h.advanceTo(6.0);
    expect(h.updates).toEqual([
      { freq: 27307, on: false, atSec: 5.0 },
      { freq: 27307, on: true, atSec: 5.000015 },
      { freq: 27307, on: false, atSec: 5.001715 },
      { freq: 23406, on: false, atSec: 5.003624 },
      { freq: 23406, on: true, atSec: 5.003639 },
      { freq: 23406, on: false, atSec: 5.010829 },
    ]);
  });

  it("does not stretch a batch when the clock has already run past some events", () => {
    // Der Batch kam mit 3 ms Verzögerung an: `at - at0` = 0/1/2 ms, aber die Uhr
    // steht schon 3 ms nach dem Anker. Alle drei müssen sofort/auf ihrer
    // absoluten Position landen — nicht nacheinander um je 1/2 ms gestreckt.
    const h = makeHarness({ clockStart: 1.0 });
    h.replayer.play([
      { at: 0, freq: 100, play: true },
      { at: 1000, freq: 100, play: false },
      { at: 2000, freq: 100, play: true },
    ]);
    // Anker = jetzt (1.0); das erste Ereignis klingt sofort.
    expect(h.updates).toEqual([{ freq: 100, on: true, atSec: 1.0 }]);
    h.advanceTo(1.05);
    const times = h.updates.map((u) => u.atSec);
    expect(times).toEqual([1.0, 1.001, 1.002]);
    // Der letzte Einsatz liegt 2 ms nach dem ersten, nicht 3 ms (kein Stretch).
    expect(times[times.length - 1] - times[0]).toBeCloseTo(0.002, 9);
  });

  it("cancels the previous batch when a newer one arrives", () => {
    const h = makeHarness({ clockStart: 5.0 });
    h.replayer.play(chirp);
    expect(h.replayer.pendingCount()).toBe(5);
    h.advanceTo(5.0005); // der 15-µs-Blitz ist gelaufen
    const afterFirst = h.updates.length;
    // Ein neuer Batch ist die neuere Wahrheit.
    h.replayer.play([{ at: 20000, freq: 23406, play: true }]);
    expect(h.replayer.pendingCount()).toBe(0);
    h.advanceTo(6.0);
    // Nichts aus Batch 1 feuert mehr; nur Batch 2s einziges Ereignis kommt dazu,
    // verankert an der Uhr beim Eintreffen von Batch 2 (5.0005).
    expect(h.updates.slice(afterFirst)).toEqual([{ freq: 23406, on: true, atSec: 5.0005 }]);
  });

  it("stop() cancels everything and plays nothing further", () => {
    const h = makeHarness({ clockStart: 5.0 });
    h.replayer.play(chirp);
    h.replayer.stop();
    expect(h.replayer.pendingCount()).toBe(0);
    h.advanceTo(6.0);
    expect(h.updates).toEqual([{ freq: 27307, on: false, atSec: 5.0 }]);
  });
});
