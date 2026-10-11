import { describe, it, expect, vi } from "vitest";
import { drawLcd } from "@/render/lcd";
import { LCD_WIDTH, LCD_HEIGHT } from "@/emu/emulator";

function mockCtx() {
  return {
    imageSmoothingEnabled: true,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D & { fillRect: ReturnType<typeof vi.fn> };
}

describe("drawLcd", () => {
  it("zeichnet Hintergrund + nur gesetzte Pixel", () => {
    const ctx = mockCtx();
    const lcd = new Uint8Array(LCD_WIDTH * LCD_HEIGHT);
    lcd[0] = 1;
    lcd[LCD_WIDTH * 2 + 3] = 1;
    drawLcd(ctx, lcd, 4);
    // 1 Hintergrund + 2 Pixel
    expect(ctx.fillRect).toHaveBeenCalledTimes(3);
    expect(ctx.imageSmoothingEnabled).toBe(false);
  });
});
