import type { GameState, IconId } from "../engine/types";
import type { Action } from "../engine/actions";
import { handleKey as hk, type Button } from "./buttons";

export { hk as handleKey };
export type { Button };

export const MENU_ICONS: IconId[] = ["feed", "light", "play", "medicine", "duck", "meter", "discipline"];

export function pressButton(
  state: GameState, button: Button, _nowMs: number,
): { state: GameState; action: Action | null } {
  const s = structuredClone(state);
  const m = s.menu;
  let action: Action | null = null;

  switch (m.mode) {
    case "idle":
      if (button === "A") { m.mode = "iconSelect"; m.selection = MENU_ICONS[0]; }
      else if (button === "B") { m.mode = "clockSet"; }
      break;
    case "iconSelect": {
      const i = m.selection ? MENU_ICONS.indexOf(m.selection) : -1;
      if (button === "A") { m.selection = MENU_ICONS[(i + 1) % MENU_ICONS.length]; }
      else if (button === "C") { m.mode = "idle"; m.selection = null; }
      else if (button === "B" && m.selection) {
        switch (m.selection) {
          case "feed": m.mode = "feed"; m.sub = "meal"; break;
          case "light": m.mode = "light"; m.sub = "off"; break;
          case "play": m.mode = "play"; m.sub = "0:0"; break;
          case "meter": m.mode = "meter"; m.meterPage = 0; break;
          case "medicine": action = { type: "medicine" }; m.mode = "idle"; m.selection = null; break;
          case "duck": action = { type: "clean" }; m.mode = "idle"; m.selection = null; break;
          case "discipline": action = { type: "scold" }; m.mode = "idle"; m.selection = null; break;
        }
      }
      break;
    }
    case "feed":
      if (button === "A") m.sub = m.sub === "meal" ? "snack" : "meal";
      else if (button === "B") { action = { type: "feed", kind: (m.sub as "meal" | "snack") }; m.mode = "idle"; }
      else if (button === "C") { m.mode = "idle"; }
      break;
    case "light":
      if (button === "A") m.sub = m.sub === "on" ? "off" : "on";
      else if (button === "B") { action = { type: "light", on: m.sub === "on" }; m.mode = "idle"; }
      else if (button === "C") { m.mode = "idle"; }
      break;
    case "play":
      if (button === "C") { m.mode = "idle"; }
      // Rundenergebnis wird vom Aufrufer (main) über RNG gesteuert.
      break;
    case "meter":
      if (button === "A" || button === "B") m.meterPage = (m.meterPage + 1) % 4;
      else if (button === "C") m.mode = "idle";
      break;
    case "clockSet":
      if (button === "C") m.mode = "idle";
      break;
  }
  return { state: s, action };
}
