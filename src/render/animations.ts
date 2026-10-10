import type { GameState } from "../engine/types";

export function animationOffset(state: GameState, nowMs: number): { dx: number; dy: number } {
  const phase = Math.floor(nowMs / 500) % 2;
  if (state.stage === "EGG") return { dx: phase ? 1 : -1, dy: 0 };
  if (state.flags.sleeping) return { dx: 0, dy: 0 };
  return { dx: 0, dy: phase ? 0 : -1 };
}
