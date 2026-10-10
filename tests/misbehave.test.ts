import { describe, it, expect } from "vitest";
import { createInitialState } from "@/engine/state";
import { advance } from "@/engine/simulation";
import { applyAction } from "@/engine/actions";
import { config } from "@/engine/config";
import type { GameState } from "@/engine/types";

const MIN = 60_000;

function pet(over: Partial<GameState> = {}): GameState {
  return {
    ...createInitialState(0, 42),
    stage: "CHILD",
    character: "marutchi",
    // Gerätezeit auf 12:00 setzen, damit das Pet wach ist (nicht Bettzeit).
    clock: { offsetMinutes: 12 * 60 },
    ...over,
  };
}

/** Aufmerksamer Halter: hält Herzen voll, damit der Ruf „misbehaving" ist. */
function advanceAttentive(s: GameState, ms: number): GameState {
  let cur = s;
  const target = s.lastTickAt + ms;
  for (let t = s.lastTickAt + MIN; t <= target; t += MIN) {
    cur = advance(cur, t);
    cur = { ...cur, hungry: 4, happy: 4 };
  }
  return cur;
}

describe("misbehaving / calls", () => {
  it("regelmäßiger Ruf bei vollen Herzen ⇒ misbehaving", () => {
    const s = advanceAttentive(pet(), config.attention.callIntervalMs + 2 * MIN);
    expect(s.flags.attention).toBe(true);
    expect(s.flags.misbehaving).toBe(true);
    expect(s.attentionReason).toBe("misbehave");
  });

  it("scold räumt misbehaving und attention ab und gibt Discipline", () => {
    const s = pet({
      flags: { sleeping: false, misbehaving: true, sick: false, attention: true },
      attentionSince: 0,
      attentionReason: "misbehave" as const,
    });
    const n = applyAction(s, { type: "scold" }, 1);
    expect(n.discipline).toBe(25);
    expect(n.flags.misbehaving).toBe(false);
    expect(n.flags.attention).toBe(false);
  });

  it("ignorierter Call ⇒ Care Mistake nach Fenster", () => {
    const s = pet();
    const next = advance(s, config.attention.callIntervalMs + config.attention.careMistakeWindowMs + 1);
    expect(next.careMistakes).toBeGreaterThanOrEqual(1);
  });
});
