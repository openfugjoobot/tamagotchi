import { describe, it, expect, vi } from "vitest";
import { createPiezo } from "@/emu/audio";
// Re-articulation: the server streams the piezo *level* (freq/on) and only on
// change. Two identical chirps (same freq) separated by a brief off arrive as
//   on(f=23406) → off → on(f=23406)
// A naive `update()` that only bumps the gain once cannot tell "still on" from
// "a fresh identical chirp", so the second chirp is not heard as a separate
// articulation — it blurs into a single tone. The piezo must re-attack on every
// fresh on-edge (including an identical repeated tone after an off/on).
//
// Since the replay moved onto the AudioContext clock (see `tone-replay.ts`),
// every audible event is *scheduled* on `ctx.currentTime`: the oscillator is
// started at an absolute time and the frequency/gain use `setValueAtTime`. The
// fake context therefore models the WebAudio AudioParam API (`setValueAtTime`,
// `.value`) and records the scheduled times.

function fakeCtx() {
  const oscs: Array<{ type: string; frequency: any; connect: any; start: any; stop: any; disconnect: any }> = [];
  const makeOsc = () => {
    const o = {
      type: "",
      frequency: {
        value: 0,
        setValueAtTime: vi.fn(function (this: { value: number }, v: number) {
          this.value = v;
        }),
      },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
    };
    oscs.push(o);
    return o;
  };
  const gain = {
    gain: {
      value: 0.0001,
      setValueAtTime: vi.fn(function (this: { value: number }, v: number) {
        this.value = v;
      }),
    },
    connect: vi.fn(),
  };
  const ctx = {
    // `currentTime` is modelled as a mutable property of the fake AudioContext
    // (the real one is read-only); tests advance it to drive the scheduled times.
    currentTime: 0,
    state: "running",
    createOscillator: () => makeOsc(),
    createGain: () => gain,
    destination: {},
    resume: vi.fn(),
    gain,
    oscs,
  } as unknown as { currentTime: number } & AudioContext & { gain: any; oscs: typeof oscs };
  // `osc` getter mirrors the *first* oscillator (compat with older assertions).
  Object.defineProperty(ctx, "osc", { get: () => oscs[0] });
  return ctx;
}

/** Audible gain values the piezo wrote to the gain node, in call order. */
function gainValues(ctx: AudioContext & { gain: any }): number[] {
  return ctx.gain.gain.setValueAtTime.mock.calls.map((c: number[]) => c[0]);
}

/** Scheduled gain times, in call order. */
function gainTimes(ctx: AudioContext & { gain: any }): number[] {
  return ctx.gain.gain.setValueAtTime.mock.calls.map((c: number[]) => c[1]);
}

const AUDIBLE = 0.05;

describe("piezo: re-articulation of repeated tones", () => {
  it("re-attacks the same freq on a fresh on-edge after an off", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.unlock();

    // Chirp 1.
    p.update(23406, true);
    // Off between chirps.
    p.update(23406, false);
    // Chirp 2: identical tone, but a new articulation — the waveform must be
    // restarted (stop+start) so the phase resets and the chirp is heard anew,
    // rather than the two chirps blurring into one continuous tone.
    p.update(23406, true);

    expect((ctx as any).osc.stop).toHaveBeenCalled();
    // A fresh oscillator was created and started → the waveform restarted.
    expect((ctx as any).oscs.length).toBeGreaterThan(1);
    expect((ctx as any).oscs[1].start).toHaveBeenCalled();
  });

  it("counts an articulation per fresh on-edge", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.unlock();

    p.update(23406, true); // articulation 1
    expect(p.state().articulations).toBe(1);
    p.update(23406, false); // trailing off does not count
    expect(p.state().articulations).toBe(1);
    p.update(23406, true); // articulation 2 (identical tone)
    expect(p.state().articulations).toBe(2);
    p.update(23406, true); // still on: no new articulation
    expect(p.state().articulations).toBe(2);
    p.update(23406, false);
    p.update(27307, true); // different tone: articulation 3
    expect(p.state().articulations).toBe(3);
  });

  it("does not re-attack while the tone simply stays on", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.unlock();
    p.update(23406, true);
    const starts = (ctx as any).oscs.length;
    const n = p.state().articulations;
    p.update(23406, true);
    p.update(23406, true);
    expect(p.state().articulations).toBe(n);
    // A tone that stays on must not restart the waveform every frame.
    expect((ctx as any).oscs.length).toBe(starts);
  });

  it("still mutes a re-articulated tone when muted", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.unlock();
    p.setMuted(true);
    p.update(23406, true);
    p.update(23406, false);
    p.update(23406, true);
    expect(gainValues(ctx)).not.toContain(AUDIBLE);
  });

  // A fresh articulation replaces the oscillator with a brand-new node whose
  // WebAudio default frequency is 440 Hz. The shipped guard
  // `if (hz !== currentFreq) osc.frequency.value = hz` only wrote the frequency
  // when it *changed*, so a fresh chirp carrying the SAME freq as the previous
  // one skipped the write and the new oscillator stayed at 440 Hz: the second
  // identical chirp is heard at the wrong pitch ("the tone hangs"). The
  // frequency must ALWAYS be set on the oscillator a re-attack just created.
  it("always sets the frequency on the oscillator a re-attack created (same freq)", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.unlock();

    p.update(23406, true); // first chirp: osc[0] = 2340.6 Hz
    p.update(23406, false); // off
    p.update(23406, true); // second, identical chirp on a NEW oscillator (osc[1])

    const oscs = (ctx as any).oscs;
    expect(oscs.length).toBeGreaterThan(1);
    const fresh = oscs[oscs.length - 1];
    // The fresh oscillator must carry the chirp's real frequency, not the 440 Hz
    // default it was created with.
    expect(fresh.frequency.value).toBeCloseTo(2340.6, 1);
  });

  it("sets the frequency on every re-articulation, whatever the previous tone was", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.unlock();

    p.update(27307, true);
    p.update(27307, false);
    p.update(27307, true); // same freq again -> must still be written
    p.update(23406, false);
    p.update(23406, true); // different freq

    const oscs = (ctx as any).oscs;
    const freqs = oscs.map((o: any) => o.frequency.value);
    // No oscillator may be left at its 440 Hz default once it is driving a tone.
    expect(freqs).not.toContain(440);
    expect(oscs[oscs.length - 1].frequency.value).toBeCloseTo(2340.6, 1);
  });
});

describe("piezo: sample-accurate scheduling on the AudioContext clock", () => {
  it("starts a fresh attack exactly at the requested audio-clock time", () => {
    const ctx = fakeCtx();
    ctx.currentTime = 12.5;
    const p = createPiezo(() => ctx);
    p.unlock();

    p.update(23406, true, 12.534);
    const fresh = (ctx as any).oscs[(ctx as any).oscs.length - 1];
    expect(fresh.start).toHaveBeenCalledWith(12.534);
    expect(fresh.frequency.setValueAtTime).toHaveBeenCalledWith(2340.6, 12.534);
    // The audible gain is scheduled at the same absolute position.
    expect((ctx as any).gain.gain.setValueAtTime).toHaveBeenCalledWith(AUDIBLE, 12.534);
  });

  it("defaults to 'now' when no absolute time is given (legacy level path)", () => {
    const ctx = fakeCtx();
    ctx.currentTime = 3.25;
    const p = createPiezo(() => ctx);
    p.unlock();

    p.update(23406, true);
    const fresh = (ctx as any).oscs[(ctx as any).oscs.length - 1];
    expect(fresh.start).toHaveBeenCalledWith(3.25);
    expect((ctx as any).gain.gain.setValueAtTime).toHaveBeenCalledWith(AUDIBLE, 3.25);
  });

  it("never schedules in the past: a late event lands on 'now'", () => {
    const ctx = fakeCtx();
    ctx.currentTime = 5.0;
    const p = createPiezo(() => ctx);
    p.unlock();

    // The event was meant for 4.9 s, but the clock has moved past it.
    p.update(23406, true, 4.9);
    const fresh = (ctx as any).oscs[(ctx as any).oscs.length - 1];
    expect(fresh.start).toHaveBeenCalledWith(5.0);
    expect((ctx as any).gain.gain.setValueAtTime).toHaveBeenCalledWith(AUDIBLE, 5.0);
  });

  it("writes a mid-tone frequency change at the requested time", () => {
    const ctx = fakeCtx();
    ctx.currentTime = 1.0;
    const p = createPiezo(() => ctx);
    p.unlock();

    p.update(23406, true, 1.0);
    const live = (ctx as any).oscs[(ctx as any).oscs.length - 1];
    p.update(32768, true, 1.01); // same articulation, new pitch
    expect(live.frequency.setValueAtTime).toHaveBeenCalledWith(3276.8, 1.01);
  });

  it("schedules an off transition (silence) at its absolute time", () => {
    const ctx = fakeCtx();
    ctx.currentTime = 2.0;
    const p = createPiezo(() => ctx);
    p.unlock();

    p.update(23406, true, 2.0);
    p.update(23406, false, 2.005);
    const times = gainTimes(ctx);
    // The last gain write is the silence, at the off's own position.
    expect(times[times.length - 1]).toBe(2.005);
    expect(gainValues(ctx)[gainValues(ctx).length - 1]).toBe(0.0001);
  });

  it("reports the live audio clock via state().nowSec", () => {
    const ctx = fakeCtx();
    ctx.currentTime = 7.75;
    const p = createPiezo(() => ctx);
    expect(p.state().nowSec).toBeNull(); // no context yet
    p.unlock();
    expect(p.state().nowSec).toBe(7.75);
  });
});
