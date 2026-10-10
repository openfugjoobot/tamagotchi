import type { Rng } from "./rng";

export type Side = "left" | "right";

export interface RoundResult {
  opponent: Side;
  win: boolean;
}

export const PLAY_ROUNDS = 5;
export const PLAY_WIN_THRESHOLD = 3;

/** Eine Spielrunde: der Gegner wählt per RNG eine Seite; gleiche Seite = Sieg. */
export function resolveRound(player: Side, rng: Rng): RoundResult {
  const opponent: Side = rng.nextInt(2) === 0 ? "left" : "right";
  return { opponent, win: opponent === player };
}

/** Sieg der Session, wenn mindestens die Hälfte+ der Runden gewonnen wurde. */
export function sessionWon(wins: number): boolean {
  return wins >= PLAY_WIN_THRESHOLD;
}
