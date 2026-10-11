import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { createFramebuffer } from "@/render/canvas";
import { renderScreen } from "@/render/screen";
import { ICONS, SPRITES } from "@/render/sprites";
import { createInitialState } from "@/engine/state";
import type { GameState, IconId } from "@/engine/types";

// --- Minimaler 24-bit BMP-Encoder (bottom-up, 4-Byte-Row-Padding) ---
function encodeBMP(w: number, h: number, px: (x: number, y: number) => [number, number, number]): Buffer {
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const dataSize = rowSize * h;
  const buf = Buffer.alloc(54 + dataSize);
  buf.write("BM", 0);
  buf.writeUInt32LE(54 + dataSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(dataSize, 34);
  for (let y = 0; y < h; y++) {
    const srcY = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, srcY);
      const off = 54 + y * rowSize + x * 3;
      buf[off] = b; buf[off + 1] = g; buf[off + 2] = r;
    }
  }
  return buf;
}

const SCALE = 8;
const BG: [number, number, number] = [166, 198, 90];
const FG: [number, number, number] = [27, 42, 27];

function fbToBMP(fb: { width: number; height: number; get(x: number, y: number): boolean }): Buffer {
  const w = fb.width * SCALE, h = fb.height * SCALE;
  return encodeBMP(w, h, (x, y) => (fb.get(Math.floor(x / SCALE), Math.floor(y / SCALE)) ? FG : BG));
}

it("rendert Preview-BMPs", () => {
  // 1) Vollbild im CHILD-Stadium mit Menü-Auswahl
  const st: GameState = {
    ...createInitialState(0, 42),
    stage: "CHILD",
    character: "marutchi",
    menu: { mode: "iconSelect", selection: "feed", sub: null, meterPage: 0 },
  };
  const fb = createFramebuffer();
  renderScreen(fb, st, 0);
  writeFileSync("/tmp/tama_screen.bmp", fbToBMP(fb));

  // 2) Icon-Sheet: alle Icons nebeneinander, skaliert
  const icons = Object.keys(ICONS) as IconId[];
  const cell = 8, pad = 1;
  const sheetW = icons.length * cell;
  const sheetH = 8;
  const sheet = createFramebuffer(sheetW, sheetH);
  icons.forEach((ic, i) => {
    const rows = ICONS[ic];
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++)
        if (rows[y][x] === "#") sheet.set(i * cell + pad + x, pad + y, true);
  });
  writeFileSync("/tmp/tama_icons.bmp", fbToBMP(sheet));

  // 3) Sprite-Sheet: alle Charaktere untereinander
  const keys = Object.keys(SPRITES);
  const sSheet = createFramebuffer(16, keys.length * 12);
  keys.forEach((k, i) => {
    const rows = SPRITES[k];
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++)
        if (rows[y][x] === "#") sSheet.set(x, i * 12 + y, true);
  });
  writeFileSync("/tmp/tama_sprites.bmp", fbToBMP(sSheet));
});
