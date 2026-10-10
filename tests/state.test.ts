import { describe, it, expect } from "vitest";
import { SCHEMA_VERSION, createInitialState, serialize, deserialize } from "@/engine/state";

describe("state", () => {
  it("Initialzustand ist Ei mit Defaults", () => {
    const s = createInitialState(1000, 42);
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    expect(s.stage).toBe("EGG");
    expect(s.alive).toBe(true);
    expect(s.hungry).toBe(4);
    expect(s.happy).toBe(4);
    expect(s.poops).toBe(0);
    expect(s.discipline).toBe(0);
    expect(s.rngSeed).toBe(42);
    expect(s.bornAt).toBe(1000);
  });

  it("Round-Trip bleibt identisch", () => {
    const s = createInitialState(1000, 42);
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it("korruptes JSON wirft", () => {
    expect(() => deserialize("{nicht json")).toThrow();
  });

  it("Migration setzt fehlende Felder auf Defaults", () => {
    const legacy = { schemaVersion: 0, stage: "EGG", bornAt: 5 };
    const s = deserialize(JSON.stringify(legacy));
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    expect(s.poops).toBe(0);
    expect(s.alive).toBe(true);
  });
});
