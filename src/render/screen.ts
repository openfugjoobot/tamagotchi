import type { GameState, IconId } from "../engine/types";
import type { Framebuffer } from "./canvas";
import { SPRITES, ICONS } from "./sprites";
import { animationOffset } from "./animations";

const TOP_ICONS: IconId[] = ["feed", "light", "play", "medicine"];
const BOTTOM_ICONS: IconId[] = ["duck", "meter", "discipline"];
const MENU_ICONS: IconId[] = [...TOP_ICONS, ...BOTTOM_ICONS];

function drawBitmap(fb: Framebuffer, rows: string[], ox: number, oy: number) {
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      if (rows[y][x] === "#") fb.set(ox + x, oy + y, true);
    }
  }
}

function iconPos(ic: IconId): { x: number; y: number } {
  const t = TOP_ICONS.indexOf(ic);
  if (t >= 0) return { x: 2 + t * 7, y: 0 };
  const b = BOTTOM_ICONS.indexOf(ic);
  return { x: 6 + b * 7, y: 25 };
}

export function renderScreen(fb: Framebuffer, state: GameState, nowMs: number): void {
  fb.clear();

  // Menü: Icons oben (4) und unten (3), Auswahl unterstrichen.
  const menuOpen = state.menu.mode !== "idle";
  if (menuOpen) {
    MENU_ICONS.forEach((ic) => {
      const p = iconPos(ic);
      drawBitmap(fb, ICONS[ic], p.x, p.y);
    });
    const sel = state.menu.selection;
    if (sel) {
      const p = iconPos(sel);
      const uy = TOP_ICONS.includes(sel) ? 7 : 32;
      if (uy < 32) for (let x = p.x; x < p.x + 6; x++) fb.set(x, uy, true);
    }
  }

  // Pet mittig (16×14).
  const key = state.stage === "EGG" ? "egg" : (state.character ?? "marutchi");
  const rows = SPRITES[key] ?? SPRITES.marutchi;
  const { dx, dy } = animationOffset(state, nowMs);
  const petY = menuOpen ? 8 : 9;
  drawBitmap(fb, rows, 8 + dx, petY + dy);

  // Status: Häufchen links, Krankheit/Aufmerksamkeit rechts.
  if (state.poops > 0 && state.poops <= 4) {
    for (let i = 0; i < state.poops; i++) drawBitmap(fb, SPRITES.poop, 0, 8 + i * 4);
  }
  if (state.flags.sick) drawBitmap(fb, SPRITES.skull, 27, 16);
  if (state.flags.attention) drawBitmap(fb, ICONS.attention, 26, 8);
}
