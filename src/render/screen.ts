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
  const key = state.stage === "EGG" ? "egg" : (state.character ?? "marutchi");
  const rows = SPRITES[key] ?? SPRITES.marutchi;
  const { dx, dy } = animationOffset(state, nowMs);
  drawBitmap(fb, rows, 12 + dx, 6 + dy);

  // Menü-Icons am unteren Rand
  MENU_ICONS.forEach((ic, i) => {
    const selected = state.menu.selection === ic;
    if (selected || i < 3) drawBitmap(fb, ICONS[ic], 1 + i * 4, 11);
  });
  if (state.flags.attention) drawBitmap(fb, ICONS.attention, 27, 0);
  if (state.flags.sick) drawBitmap(fb, SPRITES.skull, 25, 1);
  if (state.poops > 0 && state.poops <= 4) {
    for (let i = 0; i < state.poops; i++) drawBitmap(fb, SPRITES.poop, 1 + i * 3, 1);
  }
}
