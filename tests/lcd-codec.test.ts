import { describe, it, expect } from "vitest";
import {
  LCD_PACKED_BYTES,
  ICON_PACKED_BYTES,
  packLcd,
  unpackLcd,
  packIcons,
  unpackIcons,
  iconsAreZero,
  encodeLcd,
  encodeIcons,
  decodeLcd,
  decodeIcons,
  bytesToBase64,
  base64ToBytes,
} from "@/net/lcd-codec";
import { LCD_WIDTH, LCD_HEIGHT, ICON_COUNT } from "@/emu/constants";

describe("lcd-codec", () => {
  it("sizes the packed forms to the geometry", () => {
    expect(LCD_PACKED_BYTES).toBe((LCD_WIDTH * LCD_HEIGHT) / 8); // 64
    expect(LCD_PACKED_BYTES).toBe(64);
    expect(ICON_PACKED_BYTES).toBe(1);
  });

  it("round-trips an LCD buffer through pack/unpack bit-for-bit", () => {
    const lcd = new Uint8Array(LCD_WIDTH * LCD_HEIGHT);
    lcd[0] = 1;
    lcd[7] = 1;
    lcd[8] = 1;
    lcd[511] = 1;
    const packed = packLcd(lcd);
    expect(packed).toHaveLength(64);
    expect(packed[0]).toBe(0b1000_0001); // bits 0 and 7
    expect(packed[1]).toBe(0b0000_0001); // bit 8 -> byte 1, LSB
    expect(packed[63]).toBe(0b1000_0000); // bit 511 -> byte 63, MSB
    expect(Array.from(unpackLcd(packed))).toEqual(Array.from(lcd));
  });

  it("round-trips every single-bit position (LSB-first bit order)", () => {
    for (const i of [0, 1, 3, 7, 8, 63, 64, 255, 256, 510, 511]) {
      const lcd = new Uint8Array(512);
      lcd[i] = 1;
      const back = unpackLcd(packLcd(lcd));
      expect(back[i]).toBe(1);
      let sum = 0;
      for (const b of back) sum += b;
      expect(sum).toBe(1); // exactly one lit pixel survives the round trip
    }
  });

  it("coerces truthy/garbage entries to 0/1 and reads only the first 512", () => {
    const lcd = [2, 0, "x", -1, ...new Array(600).fill(0)] as unknown as ArrayLike<number>;
    const packed = packLcd(lcd);
    const back = unpackLcd(packed);
    expect(back[0]).toBe(1); // 2 -> lit
    expect(back[1]).toBe(0);
    expect(back[2]).toBe(1); // "x" -> lit
    expect(back[3]).toBe(1); // -1 -> lit
    expect(back).toHaveLength(512);
  });

  it("pads a truncated packed LCD with zeros instead of producing a short frame", () => {
    const short = new Uint8Array([0b0000_0011]); // only byte 0
    const back = unpackLcd(short);
    expect(back).toHaveLength(512);
    expect(back[0]).toBe(1);
    expect(back[1]).toBe(1);
    expect(back[8]).toBe(0); // missing byte reads as 0
  });

  it("round-trips the 8 icon bits into one byte", () => {
    const icons = new Uint8Array(ICON_COUNT);
    icons[0] = 1;
    icons[2] = 1;
    icons[5] = 1;
    const packed = packIcons(icons);
    expect(packed).toHaveLength(1);
    expect(packed[0]).toBe(0b0010_0101); // bits 0, 2, 5
    expect(Array.from(unpackIcons(packed))).toEqual(Array.from(icons));
  });

  it("reports an all-zero icon byte (the omit case) and a lit one", () => {
    expect(iconsAreZero(packIcons(new Uint8Array(ICON_COUNT)))).toBe(true);
    const lit = new Uint8Array(ICON_COUNT);
    lit[7] = 1;
    expect(iconsAreZero(packIcons(lit))).toBe(false);
  });

  it("round-trips base64 both ways", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes))!)).toEqual(Array.from(bytes));
  });

  it("returns null for invalid base64 instead of throwing", () => {
    expect(base64ToBytes("!!!not-base64!!!")).toBeNull();
    expect(decodeLcd(123)).toBeNull();
    expect(decodeLcd(undefined)).toBeNull();
    expect(decodeLcd("!!!")).toBeNull();
  });

  it("encodes the empty LCD to an all-zero-base64 string of the expected shape", () => {
    const s = encodeLcd(new Uint8Array(512));
    expect(s).toBe(bytesToBase64(new Uint8Array(64)));
    expect(s).toHaveLength(88); // 64 bytes -> ceil(64/3)*4
    expect(Array.from(decodeLcd(s)!)).toEqual(new Array(512).fill(0));
  });

  it("encodes a nonempty LCD and decodes it identically", () => {
    const lcd = new Uint8Array(512);
    lcd[0] = 1;
    lcd[511] = 1;
    const back = decodeLcd(encodeLcd(lcd))!;
    expect(back[0]).toBe(1);
    expect(back[511]).toBe(1);
    expect(back).toHaveLength(512);
  });

  it("decodes a missing/malformed icons payload to the all-dim row", () => {
    expect(Array.from(decodeIcons(undefined))).toEqual(new Array(ICON_COUNT).fill(0));
    expect(Array.from(decodeIcons("!!!"))).toEqual(new Array(ICON_COUNT).fill(0));
    expect(decodeIcons(encodeIcons(new Uint8Array([0, 1, 0, 1, 0, 0, 0, 1]))).length).toBe(ICON_COUNT);
  });
});
