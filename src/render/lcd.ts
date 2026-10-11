import { LCD_WIDTH, LCD_HEIGHT } from "../emu/emulator";

/** Zeichnet den 32×16-LCD-Puffer (0/1) integer-skaliert auf einen 2D-Canvas. */
export function drawLcd(
  ctx: CanvasRenderingContext2D,
  lcd: Uint8Array,
  scale: number,
  fg = "#26302a",
  bg = "#cdd5c4",
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, LCD_WIDTH * scale, LCD_HEIGHT * scale);

  // feines Pixel-Grid wie beim echten LCD
  ctx.strokeStyle = "rgba(0,0,0,0.07)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= LCD_WIDTH; x++) {
    ctx.beginPath(); ctx.moveTo(x * scale + 0.5, 0); ctx.lineTo(x * scale + 0.5, LCD_HEIGHT * scale); ctx.stroke();
  }
  for (let y = 0; y <= LCD_HEIGHT; y++) {
    ctx.beginPath(); ctx.moveTo(0, y * scale + 0.5); ctx.lineTo(LCD_WIDTH * scale, y * scale + 0.5); ctx.stroke();
  }

  ctx.fillStyle = fg;
  for (let y = 0; y < LCD_HEIGHT; y++) {
    for (let x = 0; x < LCD_WIDTH; x++) {
      if (lcd[y * LCD_WIDTH + x]) ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}
