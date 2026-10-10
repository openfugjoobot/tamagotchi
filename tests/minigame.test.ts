import { describe, it, expect } from "vitest";
import { resolveRound, sessionWon, PLAY_ROUNDS, PLAY_WIN_THRESHOLD } from "@/engine/minigame";
import { createRng } from "@/engine/rng";

describe("minigame", () => {
  it("gleicher Seed ⇒ gleiche Runde", () => {
    const a = resolveRound("left", createRng(1));
    const b = resolveRound("left", createRng(1));
    expect(a).toEqual(b);
  });
  it("Sieg genau bei gleicher Seite", () => {
    const r = resolveRound("left", createRng(5));
    expect(r.win).toBe(r.opponent === "left");
  });
  it("Schwelle ist die Hälfte der Runden", () => {
    expect(PLAY_ROUNDS).toBe(5);
    expect(PLAY_WIN_THRESHOLD).toBe(3);
    expect(sessionWon(3)).toBe(true);
    expect(sessionWon(2)).toBe(false);
  });
});
