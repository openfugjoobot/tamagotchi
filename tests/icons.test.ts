import { describe, it, expect, vi } from "vitest";
import { drawIconRow } from "@/render/icons";

function mockCtx() {
  return { imageSmoothingEnabled: true, fillStyle: "", clearRect: vi.fn(), fillRect: vi.fn() } as unknown as CanvasRenderingContext2D & { fillRect: ReturnType<typeof vi.fn> };
}

describe("drawIconRow", () => {
  it("zeichnet nichts, wenn keine Bits gesetzt sind", () => {
    const ctx = mockCtx();
    drawIconRow(ctx, new Uint8Array(8), 0, 4);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
  it("zeichnet Icons der oberen Reihe (Bits 0..3)", () => {
    const ctx = mockCtx();
    drawIconRow(ctx, new Uint8Array([1, 1, 0, 0, 0, 0, 0, 0]), 0, 4);
    expect(ctx.fillRect).toHaveBeenCalled();
  });
  it("zeichnet Icons der unteren Reihe (Bits 4..7)", () => {
    const ctx = mockCtx();
    drawIconRow(ctx, new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0]), 1, 4);
    expect(ctx.fillRect).toHaveBeenCalled();
  });
});
