/**
 * Death detection from the LCD image.
 *
 * TamaLIB never calls hal->halt(), so the CPU state says nothing about death.
 * The P1 ROM draws an angel with stars when the pet dies (confirmed in the
 * 2026-10-17 spike). The angel figure is stable; only the surrounding stars
 * animate, so a whole-frame hash would never match. This compares the central
 * figure region only.
 *
 * The box and tolerance below are calibrated empirically against captured
 * frames: every sampled angel phase yields a difference of 0 inside the box,
 * while living pets differ by 62+ and a blank screen by 50.
 */
import { LCD_WIDTH, LCD_HEIGHT } from "./emulator";

/** Central figure box (x0,y0,x1,y1) — excludes the animating star border. */
const BOX = { x0: 17, y0: 1, x1: 27, y1: 14 };
/** Max differing pixels inside the box still counted as the angel. */
const TOLERANCE = 6;

function centralBits(lcd: Uint8Array): number[] {
  const out: number[] = [];
  for (let y = BOX.y0; y <= BOX.y1; y++)
    for (let x = BOX.x0; x <= BOX.x1; x++) out.push(lcd[y * LCD_WIDTH + x] ? 1 : 0);
  return out;
}

// The reference is embedded at build time to avoid a filesystem read at runtime.
// Copied verbatim from tests/fixtures/angel-p1.lcd (P1 death frame, 32x16 LCD).
const ANGEL_BITS = centralBits(
  new Uint8Array([
    1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
    0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
    0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0,
    0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
    0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0,
    0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0,
    1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0,
    1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
    1, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 1, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0,
    0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0,
    0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0,
    0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0,
    0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0,
    0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]),
);

export function isAngelFrame(lcd: Uint8Array): boolean {
  if (lcd.length < LCD_WIDTH * LCD_HEIGHT) return false;
  const bits = centralBits(lcd);
  let diff = 0;
  for (let i = 0; i < bits.length; i++) if (bits[i] !== ANGEL_BITS[i]) diff++;
  return diff <= TOLERANCE;
}
