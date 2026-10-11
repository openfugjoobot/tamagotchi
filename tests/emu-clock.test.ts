import { describe, it, expect } from "vitest";
import {
  TS_FREQ,
  TS_PER_STEP,
  UNITS_PER_MS,
  unitsForMs,
  stepsForUnits,
  Pacer,
} from "@/emu/clock";

describe("emu clock math", () => {
  it("1 s real entspricht 32768 Emulator-Einheiten", () => {
    expect(TS_FREQ).toBe(32768);
    expect(UNITS_PER_MS).toBeCloseTo(32.768, 6);
    expect(unitsForMs(1000)).toBeCloseTo(32768, 6);
  });

  it("stepsForUnits rundet auf CPU-Schritte und liefert mindestens 1", () => {
    expect(stepsForUnits(32768)).toBe(Math.round(32768 / TS_PER_STEP));
    expect(stepsForUnits(1)).toBe(1);
    expect(stepsForUnits(0)).toBe(1);
  });
});

describe("Pacer (relativ, wrap-sicher)", () => {
  it("gibt die volle Schuld in Schritten aus", () => {
    const p = new Pacer();
    p.add(32768); // 1 s emulierte Zeit
    expect(p.owedUnits).toBe(32768);
    const steps = p.take(1_000_000);
    expect(steps).toBe(Math.round(32768 / TS_PER_STEP));
    expect(p.owedUnits).toBeLessThan(TS_PER_STEP); // Schuld beglichen
  });

  it("respektiert das Schritt-Budget und behält den Rest", () => {
    const p = new Pacer();
    p.add(unitsForMs(60_000)); // 60 s
    const first = p.take(1000);
    expect(first).toBe(1000);
    expect(p.owedUnits).toBeCloseTo(unitsForMs(60_000) - 1000 * TS_PER_STEP, 6);
    // weiter abarbeiten, bis leer
    let total = first;
    for (let i = 0; i < 1000 && p.owedUnits > 0; i++) total += p.take(1000);
    expect(total).toBe(Math.round(unitsForMs(60_000) / TS_PER_STEP));
  });

  it("wird nie negativ und ignoriert nicht-positive Beträge", () => {
    const p = new Pacer();
    p.add(0);
    p.add(-500);
    expect(p.owedUnits).toBe(0);
    expect(p.take(5000)).toBe(0);
    p.add(1);
    p.take(5000);
    expect(p.owedUnits).toBe(0);
  });

  it("take(0) verbraucht nichts", () => {
    const p = new Pacer();
    p.add(32768);
    expect(p.take(0)).toBe(0);
    expect(p.owedUnits).toBe(32768);
  });
});
