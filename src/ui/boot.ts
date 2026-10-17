/**
 * The boot overlay — the full-screen `#loading` curtain ("loading …" + spinner).
 *
 * Why this is a module and not three lines in `src/main.ts`: the overlay sits at
 * z-index 50, *above* the header (30) and the account popover (`.win`, 32) that
 * carries the Google sign-in button. If it is ever left up on the signed-out
 * path, the sign-in control is physically unreachable (review 2026-10-17,
 * Important). That is a boot-path regression, and `src/main.ts` runs at import
 * time with a live DOM, so it cannot be exercised in this project's Node-only
 * test setup. Extracting the decision here — tiny, pure and DOM-injectable —
 * makes it testable, and keeps `main.ts` a thin caller.
 *
 * Contract: every terminal boot outcome (a frame arrived, signed out, no pet)
 * must *dismiss* the curtain and latch `booted`, so no later frame can spin the
 * loader back up.
 */

/** The three nodes the overlay touches. All optional: a missing node is a no-op. */
export interface BootDom {
  loading?: { classList: { add(c: string): void } } | null;
  loadtext?: { textContent: string } | null;
  loadbar?: { hidden: boolean } | null;
}

export interface BootOverlay {
  /** First frame arrived: the app is up, hide the curtain. */
  markBooted(): void;
  /** A hint while the first frame is still pending (no dismissal yet). */
  showConnecting(text: string): void;
  /**
   * No session: dismiss the curtain with an actionable message so the sign-in
   * UI is reachable. Latches `booted` so a stray late frame cannot re-spin.
   */
  showSignedOut(text: string): void;
  /** Authenticated but no pet: the same dismissal, no special message. */
  noPetAvailable(text: string): void;
  /** Has the boot finished (curtain dismissed)? */
  isBooted(): boolean;
}

/** Build the overlay controller over an injectable DOM (defaults to `document`). */
export function createBootOverlay(dom: BootDom): BootOverlay {
  let booted = false;
  const el = (id: string): HTMLElement | null =>
    typeof document === "undefined" ? null : document.getElementById(id);

  const loadtext = dom.loadtext ?? (typeof document === "undefined" ? null : document.querySelector<HTMLElement>("#loading .loadtxt"));
  const loadbar = dom.loadbar ?? (typeof document === "undefined" ? null : document.getElementById("loadbar"));
  const loading = dom.loading ?? el("loading");

  /**
   * Dismiss the curtain and latch the state. Idempotent: re-asserting `.hidden`
   * on a later call is deliberate — if anything re-showed the curtain, the
   * terminal outcome must still win. Only a first call sets the label.
   */
  const dismiss = (text: string, setLabel = true): void => {
    const first = !booted;
    booted = true;
    if (first && setLabel && loadtext) loadtext.textContent = text;
    if (first && loadbar) loadbar.hidden = true;
    loading?.classList.add("hidden");
  };

  return {
    markBooted: () => dismiss("", false),
    showConnecting: (text: string) => {
      if (booted) return;
      if (loadtext) loadtext.textContent = text;
      if (loadbar) loadbar.hidden = true;
    },
    // The fix: an actionable message *and* a dismissed curtain, not just the text.
    showSignedOut: (text: string) => dismiss(text),
    noPetAvailable: (text: string) => dismiss(text),
    isBooted: () => booted,
  };
}
