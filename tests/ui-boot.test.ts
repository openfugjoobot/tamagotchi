import { describe, it, expect } from "vitest";
import { createBootOverlay, type BootDom } from "@/ui/boot";

/**
 * Boot-path regression — Task 11 fix round 1.
 *
 * The signed-out path must dismiss the full-screen `#loading` curtain: it sits
 * at z-index 50, *above* the header (z-index 30) and the account popover
 * (`.win`, z-index 32) that holds the Google sign-in button. While it is up and
 * opaque the user cannot reach the sign-in control at all.
 *
 * The bug (review 2026-10-17, Important): `showSignedOut()` set the message
 * (`.loadtxt`) and hid the progress bar but never added `.hidden` to `#loading`
 * *and* never set `booted`, so the spinner kept turning and the curtain kept
 * covering the sign-in button. `markBooted()` — the one place that hides it —
 * is only reachable from `live.onFrame`, which never fires without a session.
 *
 * This test drives the extracted boot-overlay helper through the signed-out
 * path with a fake DOM and asserts the overlay actually gets `.hidden`. It
 * fails against the pre-fix behaviour (message set, curtain up, `booted` false)
 * and passes once `showSignedOut()` dismisses the overlay.
 */

/** A tiny fake of the three nodes the boot overlay touches. */
function fakeDom() {
  const classes = new Set<string>();
  const texts: string[] = [];
  // `#loadbar` starts hidden in the markup, so a boolean default is faithful.
  const bar: { hidden: boolean } = { hidden: true };
  const dom: BootDom = {
    loading: {
      classList: {
        add: (c: string) => { classes.add(c); },
      },
    },
    loadtext: {
      set textContent(v: string) { texts.push(v); },
    },
    loadbar: {
      get hidden() { return bar.hidden; },
      set hidden(v: boolean) { bar.hidden = v; },
    },
  };
  return {
    dom,
    classes,
    texts,
    bar,
    get barHidden() { return bar.hidden; },
  };
}

describe("boot overlay — signed-out path (Task 11 regression)", () => {
  it("dismisses #loading so the sign-in UI is reachable", () => {
    const { dom, classes } = fakeDom();
    const overlay = createBootOverlay(dom);

    overlay.showSignedOut("Sign in to start playing.");

    // The curtain is gone — reachable means `.hidden` is applied.
    expect(classes.has("hidden")).toBe(true);
  });

  it("shows the actionable message and stops the progress bar", () => {
    const f = fakeDom();
    const overlay = createBootOverlay(f.dom);

    overlay.showSignedOut("Sign in to start playing.");

    expect(f.texts).toContain("Sign in to start playing.");
    expect(f.barHidden).toBe(true);
  });

  it("shows the loader hint while connecting without dismissing", () => {
    const f = fakeDom();
    const overlay = createBootOverlay(f.dom);

    overlay.showConnecting("loading …");

    expect(f.classes.has("hidden")).toBe(false);
    expect(overlay.isBooted()).toBe(false);
  });

  it("marks the app booted so a late frame cannot re-spin the loader", () => {
    const { dom, classes } = fakeDom();
    const overlay = createBootOverlay(dom);

    overlay.showSignedOut("Sign in to start playing.");

    // After dismissing, a subsequent frame must not re-open the overlay.
    overlay.markBooted();
    expect(classes.has("hidden")).toBe(true);
    expect(overlay.isBooted()).toBe(true);
  });

  it("is idempotent: a second signed-out call keeps the curtain dismissed", () => {
    const { dom, classes } = fakeDom();
    const overlay = createBootOverlay(dom);

    overlay.showSignedOut("first");
    classes.delete("hidden"); // simulate any external re-show
    overlay.showSignedOut("second");

    expect(classes.has("hidden")).toBe(true);
  });
});
