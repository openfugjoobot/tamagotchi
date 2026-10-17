// Compact wire codec for the live LCD frame.
//
// The 32×16 monochrome LCD is 512 bits. It used to travel as a 512-entry JSON
// array of 0/1 numbers (`{t:"frame", lcd:[0,1,0,…]}`) — about 1 KB of text for
// half a kilobyte of information, and every entry parsed as a JS number on the
// client. Bit-packing the 512 bits into 64 bytes and base64-encoding them cuts
// that to an 88-character string, and lets both sides work on the raw bytes.
//
// Bit order: index `i` (row-major, `i = y*LCD_WIDTH + x`) goes to byte
// `i >> 3`, bit `i & 7` (LSB-first within each byte). The server packs, the
// client unpacks; the two must agree exactly, so the pack/unpack pair lives in
// one shared module (imported by both `server/src/ws.ts` and `src/net/live.ts`)
// rather than being written twice. Bit order is asserted by the round-trip
// tests in `tests/lcd-codec.test.ts`.
//
// The codec is browser- and Node-safe: `btoa`/`atob` exist in both (Node ≥ 16
// exposes them globally), so no Buffer/`node:` import leaks into the client
// bundle.

import { LCD_WIDTH, LCD_HEIGHT, ICON_COUNT } from "../emu/constants.js";

/** Bytes needed to bit-pack the whole LCD: 512 bits / 8 = 64. */
export const LCD_PACKED_BYTES = Math.ceil((LCD_WIDTH * LCD_HEIGHT) / 8);

/** Bytes needed to bit-pack the icon segments: 8 bits / 8 = 1. */
export const ICON_PACKED_BYTES = Math.ceil(ICON_COUNT / 8);

/**
 * Bit-pack a 0/1 LCD buffer into `LCD_PACKED_BYTES` bytes, LSB-first per byte.
 * Reads up to `LCD_PACKED_BYTES*8` entries; a short/high-entropy source is
 * coerced to 0/1 (any truthy value is a lit pixel), so a malformed upstream
 * buffer can never produce a nonzero bit from garbage.
 */
export function packLcd(lcd: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(LCD_PACKED_BYTES);
  const n = Math.min(lcd.length, LCD_PACKED_BYTES * 8);
  for (let i = 0; i < n; i++) {
    if (lcd[i]) out[i >> 3] |= 1 << (i & 7);
  }
  return out;
}

/**
 * Unpack `LCD_PACKED_BYTES` bytes back into a fresh 512-length 0/1 buffer.
 * Missing bytes (a short input) read as 0, so a truncated string still yields a
 * full, drawable frame — the renderer always gets exactly `LCD_WIDTH*LCD_HEIGHT`
 * entries.
 */
export function unpackLcd(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(LCD_WIDTH * LCD_HEIGHT);
  for (let i = 0; i < out.length; i++) {
    out[i] = (bytes[i >> 3] ?? 0) & (1 << (i & 7)) ? 1 : 0;
  }
  return out;
}

/**
 * Bit-pack up to 8 icon bits into a single byte (bit 0 = first segment). A
 * legacy `LivePet` with no `icons()` yields 0 → the whole icon byte is 0, which
 * `packIcons` reports as "all zero" to the caller so the frame can omit it.
 */
export function packIcons(icons: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(ICON_PACKED_BYTES);
  const n = Math.min(icons.length, ICON_PACKED_BYTES * 8);
  for (let i = 0; i < n; i++) {
    if (icons[i]) out[i >> 3] |= 1 << (i & 7);
  }
  return out;
}

/** True when a packed icon byte carries no lit segment (the common case). */
export function iconsAreZero(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== 0) return false;
  return true;
}

/**
 * Unpack a packed icon byte into a fresh `ICON_COUNT`-length 0/1 buffer.
 * Missing bytes read as 0, so a short/absent icon payload degrades to the
 * all-dim row instead of breaking rendering.
 */
export function unpackIcons(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(ICON_COUNT);
  for (let i = 0; i < ICON_COUNT; i++) {
    out[i] = (bytes[i >> 3] ?? 0) & (1 << (i & 7)) ? 1 : 0;
  }
  return out;
}

/** base64-encode raw bytes (browser + Node global `btoa`). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * base64-decode to raw bytes. Returns `null` on anything that is not valid
 * base64, so a malformed frame is ignored rather than throwing inside the
 * message handler (same tolerance the JSON path had for garbage input).
 */
export function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Bit-pack the LCD and base64 it — the exact `lcd` string put on the wire. */
export function encodeLcd(lcd: ArrayLike<number>): string {
  return bytesToBase64(packLcd(lcd));
}

/** Bit-pack the icons and base64 them — the `icons` string put on the wire. */
export function encodeIcons(icons: ArrayLike<number>): string {
  return bytesToBase64(packIcons(icons));
}

/**
 * Decode the wire `lcd` field into a full 512-length 0/1 buffer. Accepts the
 * compact base64 string; returns `null` for anything else (absent, wrong type,
 * or invalid base64), so the caller can fall back to a legacy payload.
 */
export function decodeLcd(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  const bytes = base64ToBytes(value);
  return bytes === null ? null : unpackLcd(bytes);
}

/**
 * Decode the wire `icons` field into an `ICON_COUNT` 0/1 buffer. A missing /
 * malformed payload degrades to all-zero (the dim row), never to a throw:
 * icons are optional and a legacy server simply omits them.
 */
export function decodeIcons(value: unknown): Uint8Array {
  if (typeof value !== "string") return new Uint8Array(ICON_COUNT);
  const bytes = base64ToBytes(value);
  return bytes === null ? new Uint8Array(ICON_COUNT) : unpackIcons(bytes);
}
