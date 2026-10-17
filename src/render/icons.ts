import { LCD_WIDTH, ICON_COUNT } from "../emu/constants";

/** Echte P1-Icons (14×14 PNGs, aus GMMan/flipperzero-tamagotch-p1). */
export const ICON_SRCS = Array.from({ length: ICON_COUNT }, (_, i) => `/emu/icons/${i}.png`);

const ICON_SLOT = 8;   // logische Breite pro Icon
const ICON_ROW_H = 8;  // logische Höhe der Leiste
const ICON_PAD = 2.5;  // Luft um jedes Icon
const ICON_INNER = ICON_SLOT - 2 * ICON_PAD; // 3

/** Linienfarbe des Auswahl-Rings (clientseitig abgeleitet, s. `emu/menu.ts`). */
const ICON_HIGHLIGHT_COLOR = "#ffb300";

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

/** Lädt die 8 P1-Icon-Grafiken und keyt den weißen Hintergrund weg. */
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
 * Zeichnet das Icon-Raster der Anleitung (echte P1-Icons + Namen).
 * Genutzt von der Guide-Seite und dem Anleitungs-Fenster im Spiel.
 */
export function renderIconGrid(container: HTMLElement, names: string[]): void {
  container.replaceChildren();
  names.forEach((name, i) => {
    const item = document.createElement("div");
    item.className = "lcd-item";
    const img = document.createElement("img");
    img.src = `/emu/icons/${i}.png`;
    img.alt = name;
    img.width = 22;
    img.height = 22;
    const span = document.createElement("span");
    span.textContent = name;
    item.append(img, span);
    container.appendChild(item);
  });
}

/**
 * Zeichnet eine Icon-Reihe (4 Slots). Alle Icons sichtbar;
 * aktive Segmente (ROM-Bit = 1) voll, inaktive dezent.
 *
 * Die `bits` stammen jetzt aus dem Live-Frame (`{t:"frame", lcd, icons}`), nicht
 * mehr aus einem hartkodierten leeren Puffer: die Reihe spiegelt einen echten,
 * übertragenen Zustand. Beim ausgelieferten P1-ROM treibt das ROM die
 * Segmente derzeit nicht (die gedruckten Menü-Icons sind keine ROM-Segmente),
 * daher liest die Reihe faktisch durchgehend dezent — aber sie leuchtet auf,
 * sobald ein ROM/Gerät die Segmente treibt, ohne weitere Protokolländerung.
 *
 * `highlight` ist die **clientseitig abgeleitete** Auswahl aus `emu/menu.ts`
 * (A-Taste wandert über den Ring). Sie liegt als zusätzlicher Ring um das Icon
 * und lässt die ROM-Bits unberührt: das Gerät meldet die Auswahl nicht, daher
 * bleibt die Segment-Opazität exakt die übertragene — die Hervorhebung ist ein
 * bewusst als abgeleitet erkennbarer Zusatz, kein vorgetäuschter Segmentzustand.
 */
export function drawIconRow(
  ctx: CanvasRenderingContext2D,
  bits: Uint8Array,
  row: 0 | 1,
  scale: number,
  imgs: IconImages,
  highlight = -1,
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
  // Auswahl-Ring zuletzt, über den Icons, und unabhängig von deren Opazität.
  if (highlight >= row * 4 && highlight < (row + 1) * 4) {
    const cell = highlight - row * 4;
    ctx.globalAlpha = 1;
    ctx.fillStyle = ICON_HIGHLIGHT_COLOR;
    // Ein 1-Pixel-Rahmen um die Zelle, einen Pixel innerhalb der Slot-Kanten,
    // damit die Kanten der Nachbarzellen nicht überlappen.
    const x0 = Math.round((cell * ICON_SLOT + 0.5) * scale);
    const y0 = Math.round(0.5 * scale);
    const x1 = Math.round(((cell + 1) * ICON_SLOT - 0.5) * scale) - 1;
    const y1 = Math.round((ICON_ROW_H - 0.5) * scale) - 1;
    const t = Math.max(1, Math.round(scale)); // Rahmenbreite 1 logisches Pixel
    ctx.fillRect(x0, y0, x1 - x0 + 1, t);            // oben
    ctx.fillRect(x0, y1 - t + 1, x1 - x0 + 1, t);    // unten
    ctx.fillRect(x0, y0, t, y1 - y0 + 1);            // links
    ctx.fillRect(x1 - t + 1, y0, t, y1 - y0 + 1);    // rechts
  }
  ctx.globalAlpha = 1;
}

export const ICON_ROW = { width: LCD_WIDTH, height: ICON_ROW_H };
