import { describe, it, expect } from "vitest";
import { createInitialState } from "@/engine/state";
import { advance } from "@/engine/simulation";
import { maybeEvolve } from "@/engine/lifecycle";
import { applyAction } from "@/engine/actions";
import type { GameState } from "@/engine/types";

const MIN = 60_000;

function run(s: GameState, ms: number, step = MIN): GameState {
  let t = s.lastTickAt;
  const end = t + ms;
  let cur = s;
  while (t < end) {
    t = Math.min(end, t + step);
    cur = maybeEvolve(advance(cur, t), t);
    if (cur.hungry === 0) cur = applyAction(cur, { type: "feed", kind: "meal" }, t);
    if (cur.happy === 0) cur = applyAction(cur, { type: "feed", kind: "snack" }, t);
  }
  return cur;
}

describe("Integration: Ei → Adult", () => {
  it("durchläuft alle Stufen", () => {
    let s = createInitialState(0, 42);
    s = run(s, 5 * MIN);
    expect(s.stage).toBe("BABY");
    s = run(s, 65 * MIN);
    expect(s.stage).toBe("CHILD");
  });

  it("gut gepflegter Lauf erreicht später Adult oder stirbt nicht früh", () => {
    let s = createInitialState(0, 42);
    s = run(s, 60 * 24 * MIN);
    expect(["TEEN", "ADULT", "DEAD"]).toContain(s.stage);
  });
});
