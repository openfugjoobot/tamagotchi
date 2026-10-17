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
 * frames: the captured angel frame yields a difference of 0 inside the box,
 * while the living pet differs by 66 and a blank screen by 50. TOLERANCE is 6,
 * so a real angel frame sits 6 below the accept boundary and rejected frames
 * sit 44+ above it. tests/emu-death.test.ts asserts this margin directly and
 * fails if BOX is shrunk below the figure (see the "calibration" describe).
 */
import { LCD_WIDTH, LCD_HEIGHT } from "./emulator";

/** Central figure box (x0,y0,x1,y1) — excludes the animating star border. */
export const BOX = { x0: 17, y0: 1, x1: 27, y1: 14 };
/** Max differing pixels inside the box still counted as the angel. */
export const TOLERANCE = 6;

/** Number of LCD pixels the box covers (x0..x1 inclusive × y0..y1 inclusive). */
export function boxArea(box = BOX): number {
  return (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1);
}

function centralBits(lcd: Uint8Array): number[] {
  const out: number[] = [];
  for (let y = BOX.y0; y <= BOX.y1; y++)
    for (let x = BOX.x0; x <= BOX.x1; x++) out.push(lcd[y * LCD_WIDTH + x] ? 1 : 0);
  return out;
}

/**
 * Number of pixels inside {@link BOX} that differ from the embedded angel
 * reference. Exposed so tests can guard the calibration margin (the distance
 * between an accepted frame and {@link TOLERANCE}) instead of only the final
 * boolean verdict.
 */
export function angelDiff(lcd: Uint8Array): number {
  if (lcd.length < LCD_WIDTH * LCD_HEIGHT) return boxArea();
  const bits = centralBits(lcd);
  let diff = 0;
  for (let i = 0; i < bits.length; i++) if (bits[i] !== ANGEL_BITS[i]) diff++;
  return diff;
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
  return angelDiff(lcd) <= TOLERANCE;
}
