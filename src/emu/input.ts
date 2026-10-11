import type { Btn } from "./emulator";

/** P1: linke/mittlere/rechte Taste. */
export const BUTTON_MAP: Record<"A" | "B" | "C", Btn> = {
  A: "left",
  B: "middle",
  C: "right",
};

export type LogicalButton = "A" | "B" | "C";

/** Tastatur-Mapping auf die logischen Buttons. */
export function handleKey(key: string): LogicalButton | null {
  switch (key) {
    case "a": case "A": case "ArrowLeft": return "A";
    case "Enter": case " ": return "B";
    case "Escape": case "ArrowRight": return "C";
    default: return null;
  }
}
