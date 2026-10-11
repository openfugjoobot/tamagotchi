import { LCD_WIDTH, LCD_HEIGHT } from "../emu/emulator";

/** Zeichnet den 32×16-LCD-Puffer (0/1) integer-skaliert auf einen 2D-Canvas. */
export function drawLcd(
  ctx: CanvasRenderingContext2D,
  lcd: Uint8Array,
  scale: number,
  fg = "#2a2a2a",
  bg = "#d8dcd6",
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, LCD_WIDTH * scale, LCD_HEIGHT * scale);
  ctx.fillStyle = fg;
  for (let y = 0; y < LCD_HEIGHT; y++) {
    for (let x = 0; x < LCD_WIDTH; x++) {
      if (lcd[y * LCD_WIDTH + x]) ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}
