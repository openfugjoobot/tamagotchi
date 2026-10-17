import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAngelFrame, angelDiff, boxArea, BOX, TOLERANCE } from "@/emu/death";

// Reference frames captured from the P1 ROM (see docs/BEEPS.md / spike).
// The angel with stars is the death image; a living pet shows a hatched figure.
const angel = new Uint8Array(readFileSync(resolve("tests/fixtures/angel-p1.lcd")));
const living = new Uint8Array(readFileSync(resolve("tests/fixtures/living-p1.lcd")));
const blank = new Uint8Array(512);

describe("isAngelFrame", () => {
  it("recognises the death (angel) frame", () => {
    expect(isAngelFrame(angel)).toBe(true);
  });
  it("rejects a living frame", () => {
    expect(isAngelFrame(living)).toBe(false);
  });
  it("rejects a blank screen", () => {
    expect(isAngelFrame(blank)).toBe(false);
  });
  it("rejects a buffer shorter than one LCD frame", () => {
    expect(isAngelFrame(new Uint8Array(100))).toBe(false);
  });
});

// These tests guard the *calibration*, not just the verdict. Without them a
// shrunk BOX overfits: 2 500+ sub-figure boxes pass the three verdict tests
// above while detecting nothing (review finding, fix round 1).
describe("angel-frame calibration", () => {
  it("accepts a genuine angel frame with margin, not on the boundary", () => {
    // The captured frame must match the embedded reference exactly; anything
    // above 0 means the embedded bytes drifted from tests/fixtures/angel-p1.lcd.
    expect(angelDiff(angel)).toBe(0);
    expect(angelDiff(angel)).toBeLessThan(TOLERANCE);
  });

  it("keeps a wide margin between rejected frames and the tolerance", () => {
    // A regression that widens the box or lowers separation shows up here
    // long before the boolean verdict flips. Require rejected frames to sit
    // well clear of TOLERANCE (observed: living 66, blank 50).
    expect(angelDiff(living)).toBeGreaterThan(TOLERANCE + 30);
    expect(angelDiff(blank)).toBeGreaterThan(TOLERANCE + 30);
  });

  it("rejects a too-small detection box that would overfit the fixtures", () => {
    // The box must cover the whole central figure, not a lucky corner. The
    // captured figure occupies >= 24 columns x >= 10 rows; a box smaller than
    // that passes the verdict tests by accident.
    const width = BOX.x1 - BOX.x0 + 1;
    const height = BOX.y1 - BOX.y0 + 1;
    expect(width).toBeGreaterThanOrEqual(8);
    expect(height).toBeGreaterThanOrEqual(8);
    expect(boxArea()).toBeGreaterThanOrEqual(120);
  });
});
