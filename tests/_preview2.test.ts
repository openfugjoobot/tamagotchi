import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { drawLcd } from "@/render/lcd";
import { drawIconRow } from "@/render/icons";
import { LCD_WIDTH, LCD_HEIGHT } from "@/emu/emulator";

const ICON_H = 7;
const W = LCD_WIDTH;
const H = ICON_H + LCD_HEIGHT + ICON_H; // 7 + 16 + 7 = 30

const px = new Uint8Array(W * H); // 0 = bg, 1 = ink

// Minimaler Canvas-Shim, der fillRect in das Pixelraster schreibt.
function shim(offsetY: number, scale = 1) {
  let fill = "#000000";
  return {
    imageSmoothingEnabled: true,
    strokeStyle: "", lineWidth: 1,
    get fillStyle() { return fill; },
    set fillStyle(v: string) { fill = v; },
    clearRect() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    fillRect(x: number, y: number, w: number, h: number) {
      const dark = fill !== "#cdd5c4";
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          const gx = Math.floor(x + xx), gy = Math.floor(y + yy) + offsetY;
          if (gx >= 0 && gx < W && gy >= 0 && gy < H && dark) px[gy * W + gx] = 1;
        }
      }
    },
  } as unknown as CanvasRenderingContext2D;
}

function bmp(): Buffer {
  const rowSize = Math.ceil((W * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + rowSize * H);
  buf.write("BM", 0); buf.writeUInt32LE(54 + rowSize * H, 2); buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14); buf.writeInt32LE(W, 18); buf.writeInt32LE(H, 22);
  buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(rowSize * H, 34);
  for (let y = 0; y < H; y++) {
    const sy = H - 1 - y;
    for (let x = 0; x < W; x++) {
      const on = px[sy * W + x];
      const o = 54 + y * rowSize + x * 3;
      const c = on ? [38, 48, 42] : [205, 213, 196];
      buf[o] = c[2]; buf[o + 1] = c[1]; buf[o + 2] = c[0];
    }
  }
  return buf;
}

it("preview LCD + Icons", () => {
  px.fill(0);
  const lcd = new Uint8Array(LCD_WIDTH * LCD_HEIGHT);
  // Beispiel-Pet
  for (const [x, y] of [[14, 6], [15, 6], [13, 7], [16, 7], [14, 9], [15, 9]] as const) lcd[y * W + x] = 1;
  drawIconRow(shim(0), new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1]), 0, 1);
  drawLcd(shim(ICON_H), lcd, 1);
  drawIconRow(shim(ICON_H + LCD_HEIGHT), new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1]), 1, 1);
  writeFileSync("/tmp/emu_preview.bmp", bmp());

  let out = "";
  for (let y = 0; y < H; y++) {
    let line = "";
    for (let x = 0; x < W; x++) line += px[y * W + x] ? "#" : ".";
    out += line + "\n";
  }
  console.log("\n" + out);
  writeFileSync("/tmp/emu_preview.txt", out);
});
