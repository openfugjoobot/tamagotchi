import { describe, it, expect } from "vitest";
import { BUTTON_MAP, handleKey } from "@/emu/input";

describe("emu input", () => {
  it("A/B/C mappen auf left/middle/right", () => {
    expect(BUTTON_MAP).toEqual({ A: "left", B: "middle", C: "right" });
  });
  it("Tastatur-Mapping", () => {
    expect(handleKey("ArrowLeft")).toBe("A");
    expect(handleKey("Enter")).toBe("B");
    expect(handleKey("ArrowRight")).toBe("C");
    // Escape schließt nur Dialoge, drückt keinen Pet-Button.
    expect(handleKey("Escape")).toBeNull();
    expect(handleKey("z")).toBeNull();
  });
});
