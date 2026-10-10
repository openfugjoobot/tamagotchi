import { describe, it, expect } from "vitest";
import { createInitialState } from "@/engine/state";
import { applyAction } from "@/engine/actions";

function pet(over = {}) {
  return { ...createInitialState(0, 42), stage: "CHILD" as const, character: "marutchi" as const, ...over };
}

describe("actions", () => {
  it("meal füllt ein Hungry-Herz und erhöht Gewicht", () => {
    const s = pet({ hungry: 2, weight: 10 });
    const n = applyAction(s, { type: "feed", kind: "meal" }, 1);
    expect(n.hungry).toBe(3); expect(n.weight).toBe(11);
  });
  it("meal bei vollem Hungry ist no-op", () => {
    const s = pet({ hungry: 4 });
    expect(applyAction(s, { type: "feed", kind: "meal" }, 1)).toEqual(s);
  });
  it("play win gibt Happy, verliert Gewicht", () => {
    const s = pet({ happy: 2, weight: 15 });
    const n = applyAction(s, { type: "play", result: "win" }, 1);
    expect(n.happy).toBe(3); expect(n.weight).toBe(14);
  });
  it("medicine heilt nach 2 Gaben", () => {
    const s = pet({ flags: { sleeping: false, misbehaving: false, sick: true, attention: false }, sickSince: 0 });
    const a = applyAction(s, { type: "medicine" }, 1);
    expect(a.sickShots).toBe(1); expect(a.flags.sick).toBe(true);
    const b = applyAction(a, { type: "medicine" }, 2);
    expect(b.flags.sick).toBe(false); expect(b.sickShots).toBe(0);
  });
  it("clean entfernt Poops", () => {
    expect(applyAction(pet({ poops: 3 }), { type: "clean" }, 1).poops).toBe(0);
  });
  it("scold erhöht Discipline nur bei misbehaving", () => {
    const m = pet({ flags: { sleeping: false, misbehaving: true, sick: false, attention: false } });
    expect(applyAction(m, { type: "scold" }, 1).discipline).toBe(25);
    expect(applyAction(pet(), { type: "scold" }, 1).discipline).toBe(0);
  });
});
