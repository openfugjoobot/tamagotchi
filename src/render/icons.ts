import { LCD_WIDTH } from "../emu/emulator";

/** Echte P1-Icons (14×14 PNGs, aus GMMan/flipperzero-tamagotch-p1). */
export const ICON_SRCS = Array.from({ length: 8 }, (_, i) => `/emu/icons/${i}.png`);

const ICON_SLOT = 8;   // logische Breite pro Icon
const ICON_ROW_H = 8;  // logische Höhe der Leiste

export type IconImages = (HTMLImageElement | null)[];

export async function loadIcons(): Promise<IconImages> {
  return Promise.all(
    ICON_SRCS.map(
      (src) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = src;
        }),
    ),
  );
}

/**
 * Zeichnet eine Icon-Reihe (4 Slots). Alle Icons sichtbar;
 * aktive (ROM-Bit) voll, inaktive dezent.
 */
export function drawIconRow(
  ctx: CanvasRenderingContext2D,
  bits: Uint8Array,
  row: 0 | 1,
  scale: number,
  imgs: IconImages,
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, LCD_WIDTH * scale, ICON_ROW_H * scale);
  for (let i = 0; i < 4; i++) {
    const idx = row * 4 + i;
    const img = imgs[idx];
    if (!img) continue;
    ctx.globalAlpha = bits[idx] ? 1 : 0.25;
    ctx.drawImage(img, i * ICON_SLOT * scale, 0, ICON_SLOT * scale, ICON_ROW_H * scale);
  }
  ctx.globalAlpha = 1;
}

export const ICON_ROW = { width: LCD_WIDTH, height: ICON_ROW_H };
