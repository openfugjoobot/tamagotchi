import { LCD_WIDTH } from "../emu/emulator";

/** Die 8 P1-Icons als 8×7-Bitmaps (Reihe 0 = oben: 0..3, Reihe 1 = unten: 4..7). */
export const ICON_BITMAPS: string[][] = [
  ["........", ".#....#.", "########", "########", ".######.", "........", "........"],
  ["..####..", ".######.", "#......#", "#......#", ".######.", "..####..", "..####.."],
  ["..####..", ".######.", "########", "########", ".######.", "..####..", "........"],
  ["..####..", "..####..", "########", "########", "..####..", "..####..", "........"],
  ["...##...", "..####..", "...##...", "..#####.", "#####...", "........", "........"],
  ["#..#..#.", "#..#..#.", "#..#.##.", "#.##.##.", "#.##.##.", "#######.", "........"],
  ["#.......", "##......", "###.....", "####....", "###.....", "##......", "#......."],
  ["...##...", "...##...", "...##...", "...##...", "........", "...##...", "........"],
];

const ICON_W = 8;
const ICON_H = 7;

function drawBitmap(
  ctx: CanvasRenderingContext2D,
  rows: string[],
  ox: number,
  oy: number,
  scale: number,
  color: string,
) {
  ctx.fillStyle = color;
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      if (rows[y][x] === "#") ctx.fillRect((ox + x) * scale, (oy + y) * scale, scale, scale);
    }
  }
}

/**
 * Zeichnet eine Icon-Reihe (4 Slots). Alle Icons werden gezeichnet;
 * aktive (ROM-Bit) kräftig, inaktive dezent.
 */
export function drawIconRow(
  ctx: CanvasRenderingContext2D,
  bits: Uint8Array,
  row: 0 | 1,
  scale: number,
  fg = "#26302a",
  faint = "rgba(38,48,42,0.20)",
  bg = "#cdd5c4",
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, LCD_WIDTH * scale, ICON_H * scale);
  for (let i = 0; i < 4; i++) {
    const idx = row * 4 + i;
    const color = bits[idx] ? fg : faint;
    drawBitmap(ctx, ICON_BITMAPS[idx], i * ICON_W, 0, scale, color);
  }
}

export const ICON_ROW = { width: LCD_WIDTH, height: ICON_H };
