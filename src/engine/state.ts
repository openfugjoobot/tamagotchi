import type { GameState } from "./types";

export const SCHEMA_VERSION = 1;

export function createInitialState(nowMs: number, seed: number): GameState {
  return {
    schemaVersion: SCHEMA_VERSION,
    stage: "EGG",
    character: null,
    bornAt: nowMs,
    stageStartedAt: nowMs,
    lastTickAt: nowMs,
    ageYears: 0,
    hungry: 4,
    happy: 4,
    discipline: 0,
    weight: 5,
    careMistakes: 0,
    careMistakesThisStage: 0,
    poops: 0,
    flags: { sleeping: false, misbehaving: false, sick: false, attention: false },
    attentionSince: null,
    attentionReason: null,
    sickShots: 0,
    sickedThisStage: false,
    sickSince: null,
    lastMealAt: nowMs,
    lastPoopAt: nowMs,
    nextPoopAt: nowMs + 15 * 60_000,
    clock: { offsetMinutes: 0 },
    menu: { mode: "idle", selection: null, sub: null, meterPage: 0 },
    rngSeed: seed,
    soundOn: true,
    alive: true,
    deadAt: null,
    causeOfDeath: null,
  };
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function migrate(obj: unknown): GameState {
  const base = createInitialState(0, 0);
  if (typeof obj !== "object" || obj === null) throw new Error("invalid save");
  const src = obj as Record<string, unknown>;
  return {
    ...base,
    ...(src as Partial<GameState>),
    flags: { ...base.flags, ...((src.flags as object) ?? {}) },
    clock: { ...base.clock, ...((src.clock as object) ?? {}) },
    menu: { ...base.menu, ...((src.menu as object) ?? {}) },
    schemaVersion: SCHEMA_VERSION,
  };
}

export function deserialize(raw: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid save: not JSON");
  }
  return migrate(parsed);
}
