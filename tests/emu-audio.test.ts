import { describe, it, expect, vi } from "vitest";
import { createPiezo } from "@/emu/audio";

function fakeCtx() {
  const osc = { type: "", frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  const gain = { gain: { setValueAtTime: vi.fn(), value: 0.0001 }, connect: vi.fn() };
  return { currentTime: 0, state: "running", createOscillator: () => osc, createGain: () => gain, destination: {}, resume: vi.fn(), osc, gain } as unknown as AudioContext & { osc: typeof osc; gain: typeof gain };
}

describe("piezo", () => {
  it("startet keinen Ton wenn aus", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.update(440, false);
    expect((ctx as any).osc.start).not.toHaveBeenCalled();
  });
  it("spielt nichts ohne unlock (Autoplay-Policy)", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.update(440, true);
    expect((ctx as any).osc.start).not.toHaveBeenCalled();
  });
  it("spielt bei an einen Square-Oscillator", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.unlock();
    p.update(440, true);
    expect((ctx as any).osc.start).toHaveBeenCalled();
    expect((ctx as any).osc.type).toBe("square");
  });
  it("muted unterdrückt Ton (Verstärkung bleibt still)", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.unlock();
    p.setMuted(true);
    p.update(440, true);
    // Nur auf "still" gesetzt (0.0001), nie auf den hörbaren Pegel angehoben.
    const values = (ctx as any).gain.gain.setValueAtTime.mock.calls.map((c: number[]) => c[0]);
    expect(values).not.toContain(0.05);
    expect(values[values.length - 1]).toBe(0.0001);
  });
});
