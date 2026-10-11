import type { CharacterId, Stage } from "./types";

export const STAGE_ORDER: Stage[] = ["EGG", "BABY", "CHILD", "TEEN", "ADULT", "DEAD"];
export function stageIndex(s: Stage): number {
  return STAGE_ORDER.indexOf(s);
}

const MIN = 60_000;
const HOUR = 60 * MIN;

// Näherungswerte nach thaao.net/tama/p1 (P1, 1996/97). Abweichungen in DECISIONS.md.
export const config = {
  lcd: { width: 32, height: 32 },

  egg: { hatchMs: 5 * MIN },

  // Dauer je Stufe bis zur nächsten Evolution (in ms), wo zeitbasiert.
  stages: {
    BABY: { durationMs: 65 * MIN },
    CHILD: { evolveAtAgeYears: 3 },
    TEEN: { evolveAtAgeYears: 6 },
  },

  // Herzverlust-Intervalle je Stufe (ms pro verlorenem Herz).
  decay: {
    baby:   { hungryMs: 3 * MIN, happyMs: 2 * MIN },
    child:  { hungryMs: 6 * MIN, happyMs: 4 * MIN },
    teen:   { hungryMs: 9 * MIN, happyMs: 6 * MIN },
    adult:  { hungryMs: 12 * MIN, happyMs: 8 * MIN },
  },

  weight: {
    minByCharacter: {
      babytchi: 5, marutchi: 10,
      tamatchi_v1: 20, tamatchi_v2: 20,
      kuchitamatchi_v1: 20, kuchitamatchi_v2: 20,
      mametchi: 30, ginjirotchi: 30, maskutchi: 30,
      kuchipatchi: 30, nyorotchi: 30, tarakotchi: 30,
      bill: 30, oyajitchi: 30,
    } as Record<CharacterId, number>,
    max: 99,
    mealDelta: 1,
    snackDelta: 2,
    playDelta: -1,
  },

  poop: {
    intervalByStage: { BABY: 15 * MIN, CHILD: 60 * MIN, TEEN: 2 * HOUR, ADULT: 3 * HOUR } as Partial<Record<Stage, number>>,
    babyPoopOffsetsMs: [15 * MIN, 45 * MIN],
    max: 4,
  },

  // Bettzeit (Gerätezeit) je Charakter, Minuten seit Mitternacht.
  sleep: {
    byCharacter: {
      marutchi:         { from: 20 * 60, to: 9 * 60 },
      tamatchi_v1:      { from: 21 * 60, to: 9 * 60 },
      tamatchi_v2:      { from: 21 * 60, to: 9 * 60 },
      kuchitamatchi_v1: { from: 21 * 60, to: 9 * 60 },
      kuchitamatchi_v2: { from: 21 * 60, to: 9 * 60 },
      mametchi:         { from: 22 * 60, to: 9 * 60 },
      ginjirotchi:      { from: 22 * 60, to: 9 * 60 },
      kuchipatchi:      { from: 22 * 60, to: 9 * 60 },
      nyorotchi:        { from: 22 * 60, to: 9 * 60 },
      maskutchi:        { from: 23 * 60, to: 11 * 60 },
      tarakotchi:       { from: 22 * 60, to: 10 * 60 },
      bill:             { from: 22 * 60, to: 9 * 60 },
      oyajitchi:        { from: 22 * 60, to: 9 * 60 },
    } as Record<CharacterId, { from: number; to: number }>,
  },

  discipline: { scoldGain: 25 },

  age: {
    yearsOnWake: 1,
  },

  lifespan: {
    baseDays: 10,
    daysLostPerCareMistake: 0.5,
    sicknessDeathMs: 6 * HOUR,
    babySicknessMs: 33 * MIN,
  },

  attention: { windowMs: 15 * MIN, careMistakeWindowMs: 15 * MIN, callIntervalMs: 45 * MIN },
  careMistake: { windowMs: 15 * MIN },

  clock: { minutesPerDay: 24 * 60 },
} as const;

export type Config = typeof config;
