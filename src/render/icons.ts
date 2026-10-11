import { LCD_WIDTH } from "../emu/emulator";

/** Echte P1-Icons (14×14 PNGs, aus GMMan/flipperzero-tamagotch-p1). */
export const ICON_SRCS = Array.from({ length: 8 }, (_, i) => `/emu/icons/${i}.png`);

const ICON_SLOT = 8;   // logische Breite pro Icon
const ICON_ROW_H = 8;  // logische Höhe der Leiste
const ICON_PAD = 2.5;  // Luft um jedes Icon
const ICON_INNER = ICON_SLOT - 2 * ICON_PAD; // 3

export type IconImages = (HTMLCanvasElement | null)[];

/** Weißen Hintergrund wegkeyen: dunkle Pixel → Icon-Farbe, helle → transparent. */
function keyOut(img: HTMLImageElement, r: number, g: number, b: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const cx = c.getContext("2d")!;
  cx.drawImage(img, 0, 0);
  const id = cx.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum < 128) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
    else { d[i + 3] = 0; }
  }
  cx.putImageData(id, 0, 0);
  return c;
}

export async function loadIcons(): Promise<IconImages> {
  return Promise.all(
    ICON_SRCS.map(
      (src) =>
        new Promise<HTMLCanvasElement | null>((resolve) => {
          const img = new Image();
          img.onload = () => { try { resolve(keyOut(img, 38, 48, 42)); } catch { resolve(null); } };
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
    ctx.globalAlpha = bits[idx] ? 1 : 0.16;
    const size = ICON_INNER * scale;
    const dx = (i * ICON_SLOT + ICON_PAD) * scale;
    const dy = ICON_PAD * scale;
    ctx.drawImage(img, dx, dy, size, size);
  }
  ctx.globalAlpha = 1;
}

export const ICON_ROW = { width: LCD_WIDTH, height: ICON_ROW_H };
