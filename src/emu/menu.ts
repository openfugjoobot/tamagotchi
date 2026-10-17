/**
 * Menu-icon selection, derived client-side from button presses.
 *
 * The P1 ROM does **not** expose the selected menu icon: the eight icons are
 * fixed LCD segments (`hw_set_lcd_pin`, seg 8/28) that the shipped ROM never
 * drives (verified live over the real WASM/ROM — all 8 segment bits stay 0;
 * see docs/DECISIONS.md). So the icon row on screen is dim throughout and there
 * is nothing on the wire that says "the user is currently on LIGHT".
 *
 * What *is* observable is the user's own button presses. The P1 walks the menu
 * with A ("SELECT", logical `left`) and confirms with B (`middle`), while C
 * (`right`) cancels. That is enough to derive the selected icon for a
 * **browsing session** without inventing state the device does not report.
 *
 * This is a derivation, not a fact from the device, so it is deliberately
 * conservative:
 *
 *  - It only follows A presses. While the user is inside a menu item (after B)
 *    the ROM owns the screen and the derived selection is meaningless, so the
 *    selection is **suspended** until the user comes back out (C, or a fresh A
 *    press) or the browsing window times out.
 *  - The eight icons form a **ring**: pressing A past the last icon wraps to the
 *    first (the P1 menu cycles). The selection therefore never saturates — it
 *    keeps tracking the user's position around the ring.
 *  - The derived state can never *make* the row light up on its own: the caller
 *    combines it with the transmitted ROM segments (see `render/icons.ts`), so
 *    the honest all-zero row is untouched where the ROM is authoritative.
 *
 * Pure and time-injectable: no DOM, no timers, no clock. Feed it the presses
 * (and call `tick` from the frame loop) and read `selection()` for rendering.
 */
import { ICON_COUNT } from "./constants";

/**
 * How long after the last A press the derived selection stays visible, in ms.
 * The P1 auto-exits the menu after a few seconds of inactivity; 5 s mirrors
 * that browsing window without claiming the ROM's exact timing.
 */
export const MENU_BROWSE_TIMEOUT_MS = 5000;

export type MenuMode = "browsing" | "suspended";

export interface MenuSelection {
  /** Selected icon index (0..ICON_COUNT-1) while browsing; -1 otherwise. */
  index: number;
  /** `browsing` = A-driven walk is current; `suspended` = inside an item/died. */
  mode: MenuMode;
}

export interface MenuTrackerOptions {
  /** Icon count (defaults to {@link ICON_COUNT}); the ring wraps at this size. */
  iconCount?: number;
  /** Browsing window in ms (defaults to {@link MENU_BROWSE_TIMEOUT_MS}). */
  browseTimeoutMs?: number;
}

/**
 * Tracks which menu icon the user has walked to with A, from button presses.
 *
 * Call {@link press} for every logical button the user presses, {@link tick}
 * once per frame (or at least once per browsing-window) so the derivation can
 * expire, and {@link reset} when the pet goes away (death) or a new pet starts.
 */
export class MenuTracker {
  private readonly count: number;
  private readonly timeout: number;
  private index = -1;
  private suspended = false;
  /** `now` at the last A press; NaN means "never browsed". */
  private lastPressAt = Number.NaN;

  constructor(opts: MenuTrackerOptions = {}) {
    // A ring needs at least 2 slots to make wrap-around observable; clamp so a
    // nonsense option cannot produce a division-by-zero or a stuck index.
    this.count = Math.max(2, Math.floor(opts.iconCount ?? ICON_COUNT));
    this.timeout = Math.max(0, opts.browseTimeoutMs ?? MENU_BROWSE_TIMEOUT_MS);
  }

  /** Record a logical button press. `now` is the timestamp in ms. */
  press(btn: "A" | "B" | "C", now: number): void {
    switch (btn) {
      case "A": {
        // A restarts browsing even from a suspended state: whether the ROM left
        // the menu on its own or the user pressed C, a fresh A means "walk the
        // ring again". The first press selects the first icon rather than
        // stepping from a stale one.
        if (this.suspended || this.index < 0) this.index = 0;
        else this.index = (this.index + 1) % this.count;
        this.suspended = false;
        this.lastPressAt = now;
        return;
      }
      case "B":
        // Confirmed: the ROM now owns the screen (sub-menu/action). The derived
        // icon is no longer meaningful, so hide it until the user browses again.
        this.suspended = true;
        return;
      case "C":
        // Cancel/back: the ROM returns to the pet. Same reasoning as B.
        this.suspended = true;
        return;
    }
  }

  /** Advance the clock so the browsing window can expire. */
  tick(now: number): void {
    if (this.index >= 0 && !this.suspended && this.expired(now)) {
      this.index = -1;
      this.lastPressAt = Number.NaN;
    }
  }

  /** Drop the derived selection (pet died, or a different pet was started). */
  reset(): void {
    this.index = -1;
    this.suspended = false;
    this.lastPressAt = Number.NaN;
  }

  /**
   * The current derived selection. Read this every frame; it is cheap and never
   * allocates a new icon array.
   */
  selection(now: number): MenuSelection {
    if (this.index < 0 || this.suspended || this.expired(now)) {
      return { index: -1, mode: "suspended" };
    }
    return { index: this.index, mode: "browsing" };
  }

  private expired(now: number): boolean {
    return Number.isNaN(this.lastPressAt) || now - this.lastPressAt > this.timeout;
  }
}
