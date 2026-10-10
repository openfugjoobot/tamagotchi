import { config } from "../engine/config";

export interface Framebuffer {
  width: number;
  height: number;
  set(x: number, y: number, on: boolean): void;
  get(x: number, y: number): boolean;
  clear(): void;
}

export function createFramebuffer(width = config.lcd.width, height = config.lcd.height): Framebuffer {
  const buf = new Uint8Array(width * height);
  const idx = (x: number, y: number) => y * width + x;
  return {
    width, height,
    set(x, y, on) { if (x >= 0 && x < width && y >= 0 && y < height) buf[idx(x, y)] = on ? 1 : 0; },
    get(x, y) { return x >= 0 && x < width && y >= 0 && y < height ? buf[idx(x, y)] === 1 : false; },
    clear() { buf.fill(0); },
  };
}

export function blitToCanvas(ctx: CanvasRenderingContext2D, fb: Framebuffer, scale: number): void {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, fb.width * scale, fb.height * scale);
  ctx.fillStyle = "#1b2a1b";
  for (let y = 0; y < fb.height; y++) {
    for (let x = 0; x < fb.width; x++) {
      if (fb.get(x, y)) ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}
