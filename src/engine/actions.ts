import type { GameState } from "./types";
import { config } from "./config";

export type Action =
  | { type: "feed"; kind: "meal" | "snack" }
  | { type: "play"; result: "win" | "lose" }
  | { type: "light"; on: boolean }
  | { type: "medicine" }
  | { type: "clean" }
  | { type: "scold" }
  | { type: "attention" };

const clampWeight = (s: GameState, w: number) => {
  const min = s.character ? config.weight.minByCharacter[s.character] : 5;
  return Math.max(min, Math.min(config.weight.max, w));
};

export function applyAction(state: GameState, action: Action, nowMs: number): GameState {
  if (!state.alive) return state;
  const s = structuredClone(state);
  switch (action.type) {
    case "feed":
      if (action.kind === "meal") {
        if (s.hungry >= 4) return state;
        s.hungry += 1;
        s.weight = clampWeight(s, s.weight + config.weight.mealDelta);
      } else {
        if (s.happy >= 4) return state;
        s.happy += 1;
        s.weight = clampWeight(s, s.weight + config.weight.snackDelta);
      }
      s.lastMealAt = nowMs;
      break;
    case "play":
      if (s.happy >= 4 || s.flags.misbehaving) return state;
      if (action.result === "win") {
        s.happy += 1;
        s.weight = clampWeight(s, s.weight + config.weight.playDelta);
      }
      break;
    case "light":
      // Licht ist UI-Flag; Engine-Schlafzustand bleibt autoritativ.
      break;
    case "medicine":
      if (!s.flags.sick) return state;
      s.sickShots += 1;
      if (s.sickShots >= 2) { s.flags.sick = false; s.sickSince = null; s.sickShots = 0; }
      break;
    case "clean":
      s.poops = 0;
      break;
    case "scold":
      if (!s.flags.misbehaving) return state;
      s.discipline = Math.min(100, s.discipline + config.discipline.scoldGain) as GameState["discipline"];
      s.flags.misbehaving = false;
      break;
    case "attention":
      s.flags.attention = false;
      s.attentionSince = null;
      s.attentionReason = null;
      break;
  }
  return s;
}
