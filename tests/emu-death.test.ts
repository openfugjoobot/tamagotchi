import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAngelFrame } from "@/emu/death";

// Reference frames captured from the P1 ROM (see docs/BEEPS.md / spike).
// The angel with stars is the death image; a living pet shows a hatched figure.
const angel = readFileSync(resolve("tests/fixtures/angel-p1.lcd"));
const living = readFileSync(resolve("tests/fixtures/living-p1.lcd"));

describe("isAngelFrame", () => {
  it("recognises the death (angel) frame", () => {
    expect(isAngelFrame(new Uint8Array(angel))).toBe(true);
  });
  it("rejects a living frame", () => {
    expect(isAngelFrame(new Uint8Array(living))).toBe(false);
  });
  it("rejects a blank screen", () => {
    expect(isAngelFrame(new Uint8Array(512))).toBe(false);
  });
});
