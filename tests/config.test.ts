import { describe, it, expect } from "vitest";
import { config, STAGE_ORDER, stageIndex } from "@/engine/config";

describe("config", () => {
  it("LCD ist 32x32", () => {
    expect(config.lcd.width).toBe(32);
    expect(config.lcd.height).toBe(32);
  });
  it("Egg schlüpft nach 5 Minuten", () => {
    expect(config.egg.hatchMs).toBe(5 * 60_000);
  });
  it("Stage-Reihenfolge ist konsistent", () => {
    expect(STAGE_ORDER).toEqual(["EGG", "BABY", "CHILD", "TEEN", "ADULT", "DEAD"]);
    expect(stageIndex("BABY")).toBe(1);
    expect(stageIndex("DEAD")).toBe(5);
  });
});
