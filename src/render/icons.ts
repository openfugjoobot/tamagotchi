import { LCD_WIDTH } from "../emu/emulator";

/** Die 8 P1-Icons als 8×7-Bitmaps (Reihe 0 = oben, 1 = unten). */
export const ICON_BITMAPS: string[][] = [
  // 0 Food (Napf mit Deckel)
  ["........", ".#....#.", "########", "########", ".######.", "........", "........"],
  // 1 Light (Glühbirne)
  ["..####..", ".######.", "#......#", "#......#", ".######.", "..####..", "..####.."],
  // 2 Game (Ball)
  ["..####..", ".######.", "########", "########", ".######.", "..####..", "........"],
  // 3 Medicine (Kreuz)
  ["..####..", "..####..", "########", "########", "..####..", "..####..", "........"],
  // 4 Bathroom (Ente)
  ["...##...", "..####..", "...##...", "..#####.", "#####...", "........", "........"],
  // 5 Meter (Balken)
  ["#..#..#.", "#..#..#.", "#..#.##.", "#.##.##.", "#.##.##.", "#######.", "........"],
  // 6 Discipline (Megafon)
  ["#.......", "##......", "###.....", "####....", "###.....", "##......", "#......."],
  // 7 Attention (Ausrufezeichen)
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
 * Zeichnet eine Icon-Reihe (4 Icons) auf einen Canvas der Breite 32 (logisch).
 * bits: die 8 Icon-Flags des Emulators; row 0 = Icons 0..3 (oben), row 1 = 4..7 (unten).
 */
export function drawIconRow(
  ctx: CanvasRenderingContext2D,
  bits: Uint8Array,
  row: 0 | 1,
  scale: number,
  color = "#26302a",
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, LCD_WIDTH * scale, ICON_H * scale);
  // 4 Slots, je 8 breit → passt auf 32.
  for (let i = 0; i < 4; i++) {
    if (bits[row * 4 + i]) {
      drawBitmap(ctx, ICON_BITMAPS[row * 4 + i], i * ICON_W, 0, scale, color);
    }
  }
}

export const ICON_ROW_LOGICAL = { width: LCD_WIDTH, height: ICON_H };
