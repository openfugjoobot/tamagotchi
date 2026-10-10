import { describe, it, expect } from "vitest";
import { createInitialState } from "@/engine/state";
import { pressButton, handleKey, MENU_ICONS } from "@/input/menus";

const s0 = () => createInitialState(0, 42);

describe("menus", () => {
  it("A öffnet Icon-Auswahl", () => {
    const { state } = pressButton(s0(), "A", 1);
    expect(state.menu.mode).toBe("iconSelect");
    expect(state.menu.selection).toBe(MENU_ICONS[0]);
  });
  it("A zykelt Icons", () => {
    const a = pressButton(s0(), "A", 1).state;
    const b = pressButton(a, "A", 2).state;
    expect(b.menu.selection).toBe(MENU_ICONS[1]);
  });
  it("C hebt Auswahl auf", () => {
    const a = pressButton(s0(), "A", 1).state;
    expect(pressButton(a, "C", 2).state.menu.mode).toBe("idle");
  });
  it("B auf discipline-Icon liefert scold-Aktion", () => {
    const st = { ...s0(), menu: { ...s0().menu, mode: "iconSelect" as const, selection: "discipline" as const } };
    const { action } = pressButton(st, "B", 1);
    expect(action).toEqual({ type: "scold" });
  });
  it("Tastatur-Mapping", () => {
    expect(handleKey("ArrowLeft")).toBe("A");
    expect(handleKey("Enter")).toBe("B");
    expect(handleKey("Escape")).toBe("C");
    expect(handleKey("z")).toBeNull();
  });
});
