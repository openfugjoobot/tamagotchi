import { describe, it, expect, vi } from "vitest";
import { createSound } from "@/audio/sound";

function fakeCtx() {
  const osc = { type: "", frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  return {
    currentTime: 0,
    createOscillator: () => osc,
    createGain: () => ({ gain: { value: 0, setValueAtTime: vi.fn() }, connect: vi.fn() }),
    destination: {},
    osc,
  } as unknown as AudioContext & { osc: typeof osc };
}

describe("sound", () => {
  it("spielt Ton wenn aktiviert", () => {
    const ctx = fakeCtx();
    const s = createSound(() => ctx);
    s.play("click", true);
    expect((ctx as any).osc.start).toHaveBeenCalled();
  });
  it("spielt nichts wenn deaktiviert", () => {
    const ctx = fakeCtx();
    const s = createSound(() => ctx);
    s.play("click", false);
    expect((ctx as any).osc.start).not.toHaveBeenCalled();
  });
  it("toggle wechselt Zustand", () => {
    const s = createSound(fakeCtx);
    expect(s.toggle()).toBe(false);
    expect(s.toggle()).toBe(true);
  });
});
