import { describe, it, expect } from "vitest";
import { nextDevice, switchLabel } from "@/emu/devices";

describe("Toggle-Beschriftung", () => {
  it("zeigt im Titel das aktive Geraet", () => {
    expect(switchLabel("p1")).toBe("P1");
    expect(switchLabel("p2")).toBe("P2");
  });

  it("schaltet auf das jeweils andere Geraet", () => {
    expect(nextDevice("p1")).toBe("p2");
    expect(nextDevice("p2")).toBe("p1");
  });

  it("bleibt auf p1, wenn p2 nicht verfuegbar ist", () => {
    expect(nextDevice("p1", { p2Available: false })).toBe("p1");
  });

  it("verlaesst p2, wenn p2 nicht mehr verfuegbar ist", () => {
    expect(nextDevice("p2", { p2Available: false })).toBe("p1");
  });
});
