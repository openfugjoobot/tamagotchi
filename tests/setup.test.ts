import { describe, it, expect } from "vitest";

describe("Projekt-Setup", () => {
  it("TypeScript strict mode ist aktiv (Vitest läuft)", () => {
    const x: number = 42;
    expect(x).toBe(42);
  });

  it("Path-Alias @ zeigt auf src/", async () => {
    const mod = await import("@/emu/input");
    expect(mod.BUTTON_MAP).toBeDefined();
  });
});
