import { describe, it, expect, vi } from "vitest";
import { createPiezo } from "@/emu/audio";

function fakeCtx() {
  const osc = { type: "", frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  const gain = { gain: { value: 0, setValueAtTime: vi.fn() }, connect: vi.fn() };
  return { currentTime: 0, createOscillator: () => osc, createGain: () => gain, destination: {}, osc, gain } as unknown as AudioContext & { osc: typeof osc; gain: typeof gain };
}

describe("piezo", () => {
  it("startet keinen Ton wenn aus", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.update(440, false);
    expect((ctx as any).osc.start).not.toHaveBeenCalled();
  });
  it("spielt bei an einen Square-Oscillator", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.update(440, true);
    expect((ctx as any).osc.start).toHaveBeenCalled();
    expect((ctx as any).osc.type).toBe("square");
  });
  it("muted unterdrückt Ton", () => {
    const ctx = fakeCtx();
    const p = createPiezo(() => ctx);
    p.setMuted(true);
    p.update(440, true);
    expect((ctx as any).osc.start).not.toHaveBeenCalled();
  });
});
