// Shared emulator geometry and timing constants.
//
// These used to live in `src/emu/emulator.ts` (the removed in-tab emulator) and
// `src/emu/clock.ts`. The server-side emulator (`server/src/emulator.ts`) and
// the browser renderer both need them, so they get their own tiny module — it
// keeps the deleted emulator from leaving dangling imports behind.

export const LCD_WIDTH = 32;
export const LCD_HEIGHT = 16;
export const ICON_COUNT = 8;

/** Timestamp units per CPU step (calibrated; see docs/ARCHITECTURE.md). */
export const TS_PER_STEP = 5.648;

/** P1 buttons: A=left, B=middle, C=right. */
export type Btn = "left" | "middle" | "right";
