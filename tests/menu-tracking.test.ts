import { describe, it, expect } from "vitest";
import { MenuTracker, MENU_BROWSE_TIMEOUT_MS } from "@/emu/menu";
import { ICON_COUNT } from "@/emu/constants";

/** Convenience: a tracker whose browsing window is easy to reason about. */
function tracker(opts?: { iconCount?: number; browseTimeoutMs?: number }) {
  return new MenuTracker(opts);
}

describe("MenuTracker (derived menu-icon selection)", () => {
  it("starts suspended: no press has happened yet", () => {
    const t = tracker();
    expect(t.selection(0)).toEqual({ index: -1, mode: "suspended" });
  });

  it("selects the first icon on the first A press", () => {
    const t = tracker();
    t.press("A", 1000);
    expect(t.selection(1000)).toEqual({ index: 0, mode: "browsing" });
  });

  it("walks the ring with each further A press", () => {
    const t = tracker();
    t.press("A", 0);
    for (let i = 1; i < ICON_COUNT; i++) {
      t.press("A", i * 100);
      expect(t.selection(i * 100).index).toBe(i);
    }
  });

  it("wraps around instead of saturating at the last icon", () => {
    const t = tracker();
    t.press("A", 0);
    // Press A a full turn plus three more: past the end it must wrap, not stick.
    for (let i = 1; i <= ICON_COUNT + 3; i++) t.press("A", i);
    expect(t.selection(ICON_COUNT + 3).index).toBe(3);
  });

  it("suspends the derivation once the user confirms (B)", () => {
    const t = tracker();
    t.press("A", 0);
    t.press("A", 10);
    expect(t.selection(10)).toEqual({ index: 1, mode: "browsing" });
    t.press("B", 20); // confirmed -> inside the item, ROM owns the screen
    expect(t.selection(20)).toEqual({ index: -1, mode: "suspended" });
  });

  it("suspends the derivation on cancel (C)", () => {
    const t = tracker();
    t.press("A", 0);
    t.press("C", 5);
    expect(t.selection(5)).toEqual({ index: -1, mode: "suspended" });
  });

  it("restarts at the first icon after a suspended state", () => {
    const t = tracker();
    t.press("A", 0);
    t.press("A", 10); // index 1
    t.press("B", 20); // suspended
    t.press("A", 30); // fresh browse -> first icon, not index 2
    expect(t.selection(30).index).toBe(0);
  });

  it("expires the browsing window after the timeout", () => {
    const t = tracker({ browseTimeoutMs: 1000 });
    t.press("A", 0);
    expect(t.selection(999).index).toBe(0);
    // At the boundary the derivation is still valid (strictly-greater expiry).
    expect(t.selection(1000).index).toBe(0);
    expect(t.selection(1001)).toEqual({ index: -1, mode: "suspended" });
  });

  it("clears an expired selection on tick and lets A start over", () => {
    const t = tracker({ browseTimeoutMs: 1000 });
    t.press("A", 0);
    t.press("A", 10); // index 1
    t.tick(2000);     // past the window -> cleared
    expect(t.selection(2000).index).toBe(-1);
    t.press("A", 3000);
    expect(t.selection(3000).index).toBe(0);
  });

  it("keeps tracking while A presses stay inside the window", () => {
    const t = tracker({ browseTimeoutMs: 1000 });
    t.press("A", 0);
    // A second press 800 ms later is inside the window, so position advances.
    t.press("A", 800);
    expect(t.selection(800).index).toBe(1);
    t.press("A", 1600);
    expect(t.selection(1600).index).toBe(2);
  });

  it("does not let a B/C press extend or restart the window", () => {
    const t = tracker({ browseTimeoutMs: 1000 });
    t.press("A", 0);
    t.press("B", 400); // suspend; must not act like a fresh A
    t.tick(5000);
    t.press("A", 5000); // fresh A after suspension -> first icon
    expect(t.selection(5000).index).toBe(0);
  });

  it("reset() abandons the selection (pet died / new pet)", () => {
    const t = tracker();
    t.press("A", 0);
    t.press("A", 10);
    expect(t.selection(10).mode).toBe("browsing");
    t.reset();
    expect(t.selection(10)).toEqual({ index: -1, mode: "suspended" });
    t.press("A", 20);
    expect(t.selection(20).index).toBe(0);
  });

  it("wraps at a custom icon count", () => {
    const t = tracker({ iconCount: 3 });
    t.press("A", 0); // 0
    t.press("A", 1); // 1
    t.press("A", 2); // 2
    t.press("A", 3); // wraps -> 0
    expect(t.selection(3).index).toBe(0);
  });

  it("clamps a nonsense icon count to a usable ring", () => {
    const t = tracker({ iconCount: 1 });
    t.press("A", 0); // first icon
    t.press("A", 1); // clamped ring is 2, so this advances to icon 1
    expect(t.selection(1).index).toBe(1);
    t.press("A", 2); // ring of 2 wraps back to icon 0
    expect(t.selection(2).index).toBe(0);
  });

  it("uses the documented default browsing window", () => {
    const t = tracker();
    t.press("A", 0);
    expect(t.selection(MENU_BROWSE_TIMEOUT_MS).index).toBe(0);
    expect(t.selection(MENU_BROWSE_TIMEOUT_MS + 1).index).toBe(-1);
  });

  it("is pure across reads: selection() does not mutate state", () => {
    const t = tracker({ browseTimeoutMs: 1000 });
    t.press("A", 0);
    t.press("A", 10);
    const a = t.selection(10);
    const b = t.selection(10);
    expect(a).toEqual(b);
    // A read long after expiry must not have cleared the position for a later
    // in-window read... it cannot be in-window again, but reset-on-read would
    // also break the tick() contract. Assert selection() alone changed nothing.
    expect(t.selection(10).index).toBe(1);
  });
});
