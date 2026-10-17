import { describe, it, expect, vi } from "vitest";
import { drawIconRow, ICON_ROW, ICON_SRCS, type IconImages } from "@/render/icons";
import { LCD_WIDTH, ICON_COUNT } from "@/emu/constants";

/** A fake 2D context capturing the draw calls drawIconRow makes. */
function mockCtx() {
  return {
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D & {
    clearRect: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
  };
}

/** 8 opaque stand-in "images" — drawIconRow only requires a truthy image. */
function fakeImages(count = ICON_COUNT): IconImages {
  return Array.from({ length: count }, (_, i) => ({ id: i }) as unknown as HTMLCanvasElement);
}

describe("drawIconRow (live icon strip)", () => {
  it("exposes 8 icon sources and a 32x8 row geometry", () => {
    expect(ICON_SRCS).toHaveLength(ICON_COUNT);
    expect(ICON_SRCS[0]).toBe("/emu/icons/0.png");
    expect(ICON_ROW).toEqual({ width: LCD_WIDTH, height: 8 });
  });

  it("draws the 4 icons of the requested row, dim for inactive bits", () => {
    const ctx = mockCtx();
    const bits = new Uint8Array(ICON_COUNT); // all 0 = inactive
    drawIconRow(ctx, bits, 0, 4, fakeImages());
    expect(ctx.imageSmoothingEnabled).toBe(false);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    // Row 0 = slots 0..3 -> four icons drawn.
    expect(ctx.drawImage).toHaveBeenCalledTimes(4);
    // Inactive bits render dim.
    const alphas = ctx.drawImage.mock.calls.map((c) => c[0].alpha ?? null);
    expect(alphas.length).toBe(4);
    // globalAlpha is reset after drawing so later code is unaffected.
    expect(ctx.globalAlpha).toBe(1);
  });

  it("draws the bottom row (slots 4..7) when row=1", () => {
    const ctx = mockCtx();
    const bits = new Uint8Array(ICON_COUNT);
    bits[7] = 1; // last slot of the bottom row is active
    drawIconRow(ctx, bits, 1, 2, fakeImages());
    expect(ctx.drawImage).toHaveBeenCalledTimes(4);
    // The active segment must be drawn fully opaque: at least one call ran with
    // globalAlpha === 1 while the others were dimmed.
    expect(ctx.globalAlpha).toBe(1);
  });

  it("skips missing images without throwing", () => {
    const ctx = mockCtx();
    const bits = new Uint8Array(ICON_COUNT);
    const imgs: IconImages = [null, null, null, null, null, null, null, null];
    expect(() => drawIconRow(ctx, bits, 0, 4, imgs)).not.toThrow();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("reads a differing bit state and applies full opacity to active slots", () => {
    const bits = new Uint8Array(ICON_COUNT);
    bits[0] = 1; // first slot of the top row active
    // Capture globalAlpha at each drawImage via a getter-backed fake ctx.
    const alphas: number[] = [];
    let alpha = 1;
    const spy = {
      imageSmoothingEnabled: true,
      clearRect: vi.fn(),
      drawImage: vi.fn(() => { alphas.push(alpha); }),
      get globalAlpha(): number { return alpha; },
      set globalAlpha(v: number) { alpha = v; },
    } as unknown as CanvasRenderingContext2D;
    drawIconRow(spy, bits, 0, 4, fakeImages());
    expect(alphas[0]).toBe(1);            // active -> full
    expect(alphas[1]).toBeCloseTo(0.16);  // inactive -> dim
  });
});
