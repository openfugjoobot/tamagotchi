import { describe, it, expect } from "vitest";
import { SHELLS, starPolygon } from "@/shell";

describe("shell star shape", () => {
  it("jede Shell hat eine eigene Sternform", () => {
    for (const s of SHELLS) {
      expect(s.star.points).toBeGreaterThanOrEqual(5);
      expect(s.star.inner).toBeGreaterThan(0.3);
      expect(s.star.inner).toBeLessThan(1);
    }
    const shapes = new Set(SHELLS.map((s) => `${s.star.points}/${s.star.inner}/${s.star.rot}`));
    expect(shapes.size).toBe(SHELLS.length);
  });

  it("starPolygon liefert 2*points Punkte im 100er-Raster", () => {
    for (const s of SHELLS) {
      const pts = starPolygon(s.star).split(" ");
      expect(pts.length).toBe(s.star.points * 2);
      for (const p of pts) {
        const [x, y] = p.split(",").map(Number);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(100);
      }
    }
  });

  it("Außen- und Innenradius wechseln sich ab", () => {
    const pts = starPolygon({ points: 5, inner: 0.5, rot: 0 }).split(" ").map((p) => {
      const [x, y] = p.split(",").map(Number);
      return Math.hypot(x - 50, y - 50);
    });
    expect(pts[0]).toBeCloseTo(50, 1);
    expect(pts[1]).toBeCloseTo(25, 1);
    expect(pts[2]).toBeCloseTo(50, 1);
  });
});
