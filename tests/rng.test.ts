import { describe, it, expect } from "vitest";
import { createRng } from "@/engine/rng";
import { createFixedClock } from "@/engine/clock";

describe("rng", () => {
  it("gleicher Seed ⇒ gleiche Sequenz", () => {
    const a = createRng(42), b = createRng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
  it("nextInt bleibt im Bereich", () => {
    const r = createRng(7);
    for (let i = 0; i < 100; i++) {
      const v = r.nextInt(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
  });
});

describe("clock", () => {
  it("fixed clock ist steuerbar", () => {
    const c = createFixedClock(1000);
    expect(c.now()).toBe(1000);
    c.set(5000);
    expect(c.now()).toBe(5000);
  });
});
