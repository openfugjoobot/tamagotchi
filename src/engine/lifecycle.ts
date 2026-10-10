import type { CharacterId, GameState } from "./types";
import { config } from "./config";

export function resolveBabyToMarutchi(): CharacterId { return "marutchi"; }

export function resolveMarutchiToTeen(cm: number, disc: number): CharacterId {
  const good = disc >= 75;
  if (cm <= 1) return good ? "tamatchi_v1" : "tamatchi_v2";
  return good ? "kuchitamatchi_v1" : "kuchitamatchi_v2";
}

export function resolveTeenToAdult(teen: CharacterId, cm: number, disc: number): CharacterId {
  const early = cm <= 2;
  const d = disc >= 75 ? 75 : disc >= 50 ? 50 : 0;
  switch (teen) {
    case "tamatchi_v1":
      if (early) return disc === 100 ? "mametchi" : d === 75 ? "ginjirotchi" : "maskutchi";
      return disc === 100 ? "kuchipatchi" : d === 75 ? "nyorotchi" : "tarakotchi";
    case "tamatchi_v2":
      if (early) return disc === 100 ? "ginjirotchi" : "maskutchi";
      return disc === 100 ? "nyorotchi" : "tarakotchi";
    case "kuchitamatchi_v1":
      if (early) return disc === 100 ? "kuchipatchi" : d === 75 ? "nyorotchi" : "tarakotchi";
      return disc === 100 ? "nyorotchi" : "tarakotchi";
    case "kuchitamatchi_v2":
      if (early) return disc === 100 ? "nyorotchi" : "tarakotchi";
      return disc === 100 ? "nyorotchi" : "tarakotchi";
    default:
      return teen;
  }
}

export function maybeEvolve(state: GameState, nowMs: number): GameState {
  if (!state.alive || state.stage === "DEAD" || state.stage === "ADULT") return state;
  const s = structuredClone(state);
  const evolve = (stage: GameState["stage"], character: CharacterId) => {
    s.stage = stage;
    s.character = character;
    s.stageStartedAt = nowMs;
    s.careMistakesThisStage = 0;
    s.sickedThisStage = false;
  };
  if (s.stage === "EGG" && nowMs - s.bornAt >= config.egg.hatchMs) {
    evolve("BABY", "babytchi");
  } else if (s.stage === "BABY" && nowMs - s.stageStartedAt >= config.stages.BABY.durationMs) {
    evolve("CHILD", resolveBabyToMarutchi());
  } else if (s.stage === "CHILD" && s.ageYears >= config.stages.CHILD.evolveAtAgeYears) {
    evolve("TEEN", resolveMarutchiToTeen(s.careMistakesThisStage, s.discipline));
  } else if (s.stage === "TEEN" && s.ageYears >= config.stages.TEEN.evolveAtAgeYears) {
    evolve("ADULT", resolveTeenToAdult(s.character!, s.careMistakesThisStage, s.discipline));
  }
  return s;
}

export function checkHidden(state: GameState): GameState {
  if (state.character === "maskutchi" && state.discipline === 0 && state.ageYears >= 10) {
    return { ...state, character: "bill" };
  }
  return state;
}
