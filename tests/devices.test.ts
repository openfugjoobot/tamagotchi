import { describe, it, expect } from "vitest";
import { DEVICES } from "@/emu/devices";

describe("Geraetekonfiguration", () => {
  it("kennt genau P1 und P2", () => {
    expect(Object.keys(DEVICES).sort()).toEqual(["p1", "p2"]);
  });

  it("verweist auf die richtigen ROM-Pfade", () => {
    expect(DEVICES.p1.rom).toBe("/emu/rom0.bin");
    expect(DEVICES.p2.rom).toBe("/emu/rom2.bin");
  });

  it("beschriftet beide Geraete kurz mit ihrem Namen", () => {
    expect(DEVICES.p1.label).toBe("P1");
    expect(DEVICES.p2.label).toBe("P2");
  });
});
