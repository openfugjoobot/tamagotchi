import type { GameState, IconId } from "../engine/types";
import type { Framebuffer } from "./canvas";
import { SPRITES, ICONS } from "./sprites";
import { animationOffset } from "./animations";

const MENU_ICONS: IconId[] = ["feed", "light", "play", "medicine", "duck", "meter", "discipline"];

function drawBitmap(fb: Framebuffer, rows: string[], ox: number, oy: number) {
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      if (rows[y][x] === "#") fb.set(ox + x, oy + y, true);
    }
  }
}

export function renderScreen(fb: Framebuffer, state: GameState, nowMs: number): void {
  fb.clear();

  // Obere Reihe: die 7 Menü-Icons.
  MENU_ICONS.forEach((ic, i) => drawBitmap(fb, ICONS[ic], 2 + i * 4, 0));

  // Auswahl unterstreichen.
  const sel = state.menu.selection;
  if (sel) {
    const i = MENU_ICONS.indexOf(sel);
    if (i >= 0) {
      const x0 = 2 + i * 4;
      for (let x = x0; x < x0 + 4; x++) fb.set(x, 6, true);
    }
  }

  // Pet in der Mitte (10 breit).
  const key = state.stage === "EGG" ? "egg" : (state.character ?? "marutchi");
  const rows = SPRITES[key] ?? SPRITES.marutchi;
  const { dx, dy } = animationOffset(state, nowMs);
  drawBitmap(fb, rows, 11 + dx, 7 + dy);

  // Status-Indikatoren.
  if (state.poops > 0 && state.poops <= 4) {
    for (let i = 0; i < state.poops; i++) drawBitmap(fb, SPRITES.poop, 1 + i * 3, 12);
  }
  if (state.flags.sick) drawBitmap(fb, SPRITES.skull, 27, 10);
  if (state.flags.attention) drawBitmap(fb, ICONS.attention, 27, 4);
}
