import { describe, it, expect } from "vitest";
import { existsSync, statSync } from "node:fs";

describe("emulator build artifacts", () => {
  it("tamalib.wasm existiert und hat plausible Größe", () => {
    expect(existsSync("public/emu/tamalib.wasm")).toBe(true);
    const size = statSync("public/emu/tamalib.wasm").size;
    expect(size).toBeGreaterThan(20_000);
    expect(size).toBeLessThan(2_000_000);
  });
  it("rom0.bin existiert und ist das P1-ROM", () => {
    expect(existsSync("public/emu/rom0.bin")).toBe(true);
    expect(statSync("public/emu/rom0.bin").size).toBe(12288);
  });
});
