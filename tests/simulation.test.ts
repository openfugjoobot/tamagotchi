import { describe, it, expect } from "vitest";
import { createInitialState } from "@/engine/state";
import { advance } from "@/engine/simulation";

const MIN = 60_000;

function hatched(now = 0) {
  const s = createInitialState(now, 42);
  return { ...s, stage: "BABY" as const, character: "babytchi" as const, stageStartedAt: now, hungry: 4, happy: 4 };
}

describe("simulation.advance", () => {
  it("mutiert den Input nicht", () => {
    const s = hatched();
    const before = JSON.stringify(s);
    advance(s, 5 * MIN);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("verliert Hunger-Herzen mit der Zeit", () => {
    const s = hatched();
    const next = advance(s, 3 * MIN + 1);
    expect(next.hungry).toBeLessThan(4);
  });

  it("Herzen gehen nie unter 0", () => {
    const s = hatched();
    const next = advance(s, 100 * MIN);
    expect(next.hungry).toBeGreaterThanOrEqual(0);
    expect(next.happy).toBeGreaterThanOrEqual(0);
  });

  it("setzt Attention bei leerem Herz", () => {
    const s = { ...hatched(), hungry: 0, happy: 0 };
    const next = advance(s, 1);
    expect(next.flags.attention).toBe(true);
    expect(next.attentionReason).toBeTruthy();
  });

  it("erzeugt Poop und capped bei max", () => {
    const s = hatched();
    const next = advance(s, 60 * MIN);
    expect(next.poops).toBeGreaterThanOrEqual(1);
    expect(next.poops).toBeLessThanOrEqual(4);
  });
});
