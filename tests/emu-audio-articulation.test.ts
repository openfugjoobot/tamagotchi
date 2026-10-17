import { describe, it, expect, vi } from "vitest";
import { createPiezo } from "@/emu/audio";

// Classic minimal piezo: one long-running oscillator, gated by the gain node,
// with the frequency written only when it changes and the node never re-created.
// The server streams the piezo *level* (`{t:"buzzer", freq, on}`, sampled at
// 20 ms); this client turns it into a square wave. No re-articulation and no
// absolute-time scheduling — a plain level gate.

const AUDIBLE = 0.05;
const SILENT = 0.0001;

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
      value: SILENT,
      setValueAtTime: vi.fn(function (this: { value: number }, v: number) {
        this.value = v;
      }),
    },
    connect: vi.fn(),
  };
  const ctx = {
    currentTime: 0,
    state: "running",
    createOscillator: () => makeOsc(),
    createGain: () => gain,
    destination: {},
    resume: vi.fn(),
    gain,
    oscs,
  } as unknown as { currentTime: number } & AudioContext & { gain: any; oscs: typeof oscs };
  Object.defineProperty(ctx, "osc", { get: () => oscs[0] });
  return ctx;
}

/** Audible gain values the piezo wrote to the gain node, in call order. */
function gainValues(ctx: AudioContext & { gain: any }): number[] {
  return ctx.gain.gain.setValueAtTime.mock.calls.map((c: number[]) => c[0]);
}

describe("piezo: one running oscillator, gain-gated", () => {
  it("creates a single square oscillator and starts it once", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.unlock();
    p.update(23406, true);
    p.update(27307, true);
    p.update(23406, false);
    expect((ctx as any).oscs.length).toBe(1);
    expect((ctx as any).osc.type).toBe("square");
    expect((ctx as any).osc.start).toHaveBeenCalledTimes(1);
  });

  it("never re-creates or restarts the oscillator across level changes", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.unlock();
    // Two identical chirps separated by an off: still the very same node.
    p.update(23406, true);
    p.update(23406, false);
    p.update(23406, true);
    expect((ctx as any).oscs.length).toBe(1);
    expect((ctx as any).osc.stop).not.toHaveBeenCalled();
    expect((ctx as any).osc.start).toHaveBeenCalledTimes(1);
  });

  it("gates the tone with the gain node", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.unlock();
    p.update(23406, true);
    expect(gainValues(ctx)).toContain(AUDIBLE);
    p.update(23406, false);
    expect(gainValues(ctx)[gainValues(ctx).length - 1]).toBe(SILENT);
  });

  it("writes the frequency in Hz (dHz/10) only when it changes", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.unlock();

    p.update(23406, true);
    expect((ctx as any).osc.frequency.value).toBeCloseTo(2340.6, 1);
    // Same freq again: no redundant write.
    const writes = (ctx as any).osc.frequency.value;
    p.update(23406, true);
    expect((ctx as any).osc.frequency.value).toBe(writes);
    // New freq: updated in place on the same node.
    p.update(32768, true);
    expect((ctx as any).osc.frequency.value).toBeCloseTo(3276.8, 1);
  });

  it("clamps a very low frequency to at least 20 Hz", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.unlock();
    p.update(10, true); // 1 Hz → clamped
    expect((ctx as any).osc.frequency.value).toBe(20);
  });

  it("stays silent while muted", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.unlock();
    p.setMuted(true);
    p.update(23406, true);
    expect(gainValues(ctx)).not.toContain(AUDIBLE);
  });
});

describe("piezo: unlock + diagnostics", () => {
  it("plays nothing before unlock (Autoplay-Policy)", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.update(440, true);
    expect((ctx as any).oscs.length).toBe(0);
  });

  it("state() reports the real context state", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    expect(p.state().created).toBe(false);
    p.unlock();
    expect(p.state().created).toBe(true);
    expect(p.state().ctxState).toBe("running");
  });

  it("update wakes a suspended context (background tab)", () => {
    const ctx = fakeCtx();
    (ctx as any).state = "suspended";
    const p = createPiezo(() => ctx);
    p.unlock();
    (ctx as any).state = "suspended"; // z. B. Tab war lange im Hintergrund
    p.update(440, true);
    expect((ctx as any).resume).toHaveBeenCalled();
  });
});
