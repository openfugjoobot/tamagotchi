import { describe, it, expect } from "vitest";
import * as keys from "@/storage/keys";

describe("storage keys", () => {
  it("sind alle eindeutig", () => {
    const vals = Object.values(keys);
    expect(new Set(vals).size).toBe(vals.length);
  });

  it("sind keine Platzhalter (der alte ***-Bug)", () => {
    for (const v of Object.values(keys)) {
      expect(v).not.toBe("***");
      expect(v.length).toBeGreaterThan(8);
      expect(v.startsWith("tamagotchi.")).toBe(true);
    }
  });
});
