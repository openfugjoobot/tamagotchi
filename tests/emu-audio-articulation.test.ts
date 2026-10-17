import { describe, it, expect, vi } from "vitest";
import { createPiezo } from "@/emu/audio";

// Re-articulation: the server streams the piezo *level* (freq/on) and only on
// change. Two identical chirps (same freq) separated by a brief off arrive as
//   on(f=23406) → off → on(f=23406)
// A naive `update()` that only bumps the gain once cannot tell "still on" from
// "a fresh identical chirp", so the second chirp is not heard as a separate
// articulation — it blurs into a single tone. The piezo must re-attack on every
// fresh on-edge (including an identical repeated tone after an off/on).

function fakeCtx() {
  const oscs: Array<{ type: string; frequency: { value: number }; connect: any; start: any; stop: any; disconnect: any }> = [];
  const makeOsc = () => {
    const o = {
      type: "",
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
    };
    oscs.push(o);
    return o;
  };
  const gain = { gain: { setValueAtTime: vi.fn(), value: 0.0001 }, connect: vi.fn() };
  const ctx = {
    currentTime: 0,
    state: "running",
    createOscillator: () => makeOsc(),
    createGain: () => gain,
    destination: {},
    resume: vi.fn(),
    gain,
    oscs,
  } as unknown as AudioContext & { gain: any; oscs: typeof oscs };
  // `osc` getter mirrors the *first* oscillator (compat with older assertions).
  Object.defineProperty(ctx, "osc", { get: () => oscs[0] });
  return ctx;
}

/** Audible gain values the piezo wrote to the gain node, in call order. */
function gainValues(ctx: AudioContext & { gain: any }): number[] {
  return ctx.gain.gain.setValueAtTime.mock.calls.map((c: number[]) => c[0]);
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
});
