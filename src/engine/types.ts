export type Stage = "EGG" | "BABY" | "CHILD" | "TEEN" | "ADULT" | "DEAD";

export type CharacterId =
  | "babytchi"
  | "marutchi"
  | "tamatchi_v1" | "tamatchi_v2"
  | "kuchitamatchi_v1" | "kuchitamatchi_v2"
  | "mametchi" | "ginjirotchi" | "maskutchi"
  | "kuchipatchi" | "nyorotchi" | "tarakotchi"
  | "bill" | "oyajitchi";

export type IconId =
  | "feed" | "light" | "play" | "medicine"
  | "duck" | "meter" | "discipline" | "attention";

export type MenuMode =
  | "idle" | "iconSelect" | "feed" | "light" | "play" | "meter" | "clockSet";

export interface Flags {
  sleeping: boolean;
  misbehaving: boolean;
  sick: boolean;
  attention: boolean;
}

export interface ClockState {
  /** Verschiebung der Gerätezeit in Minuten gegenüber Wall-Clock. */
  offsetMinutes: number;
}

export interface MenuState {
  mode: MenuMode;
  selection: IconId | null;
  sub: string | null;
  meterPage: number;
}

export interface GameState {
  schemaVersion: number;
  stage: Stage;
  character: CharacterId | null;
  bornAt: number;
  stageStartedAt: number;
  lastTickAt: number;
  ageYears: number;
  hungry: number; // 0..4
  happy: number;  // 0..4
  discipline: 0 | 25 | 50 | 75 | 100;
  weight: number;
  careMistakes: number;
  careMistakesThisStage: number;
  poops: number; // 0..4
  flags: Flags;
  attentionSince: number | null;
  attentionReason: "hungry" | "happy" | "misbehave" | null;
  sickShots: number;
  sickedThisStage: boolean;
  sickSince: number | null;
  lastMealAt: number;
  lastPoopAt: number;
  nextPoopAt: number;
  clock: ClockState;
  menu: MenuState;
  rngSeed: number;
  soundOn: boolean;
  alive: boolean;
  deadAt: number | null;
  causeOfDeath: "age" | "sickness" | "care" | null;
}
