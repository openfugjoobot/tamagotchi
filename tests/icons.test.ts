import { describe, it, expect, vi } from "vitest";
import { drawIconRow } from "@/render/icons";

function mockCtx() {
  return { imageSmoothingEnabled: true, fillStyle: "", fillRect: vi.fn() } as unknown as CanvasRenderingContext2D & { fillRect: ReturnType<typeof vi.fn> };
}

describe("drawIconRow", () => {
  it("zeichnet nur den Hintergrund, wenn keine Bits gesetzt sind", () => {
    const ctx = mockCtx();
    drawIconRow(ctx, new Uint8Array(8), 0, 4);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1); // nur BG
  });
  it("zeichnet zusätzliche Icons der oberen Reihe (Bits 0..3)", () => {
    const ctx = mockCtx();
    drawIconRow(ctx, new Uint8Array([1, 1, 0, 0, 0, 0, 0, 0]), 0, 4);
    expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(1);
  });
  it("zeichnet nur höhere Bits in der unteren Reihe (Bits 4..7)", () => {
    const ctx = mockCtx();
    drawIconRow(ctx, new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0]), 1, 4);
    expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(1);
  });
});
