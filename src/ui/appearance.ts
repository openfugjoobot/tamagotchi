/**
 * Appearance selection → server persistence (Task-11 D2, fix A2b).
 *
 * The theme and shell are user settings that live on the account (spec §3:
 * "Shell, Theme, … gelten auf allen Geräten gleich"), yet only `sound`/`push`
 * were ever written back through `persistSetting`. This module holds the one
 * piece of logic that makes theme/shell round-trip: **when a user picks an
 * appearance, persist it server-side** — but never echo a value that the server
 * just pushed onto the UI (that would loop and could clobber a concurrent
 * device's choice).
 *
 * It is deliberately DOM-free and dependency-light so the decision is unit
 * testable without jsdom: give it a `persist` sink and an `isApplying` probe,
 * get back the two selection handlers the UI wires to its theme buttons, shell
 * buttons and the shell carousel.
 */

import type { Settings } from "./settings";

/** A partial settings patch, exactly what `settingsView.save()` accepts. */
export type SettingsPatch = Partial<Settings>;

export interface AppearanceDeps {
  /** Persist a patch (in the app: `persistSetting`, a no-op when signed out). */
  persist: (patch: SettingsPatch) => void;
  /**
   * True while `applyServerSettings()` is writing a loaded value onto the UI.
   * Selections made in that window come from the server, not the user, and must
   * not be written back.
   */
  isApplying: () => boolean;
}

export interface AppearanceHandlers {
  /** User picked a background theme (`src/theme.ts` id). */
  selectTheme(id: string): void;
  /** User picked a device shell (`src/shell.ts` id). */
  selectShell(id: string): void;
}

export function createAppearanceHandlers(deps: AppearanceDeps): AppearanceHandlers {
  const selectTheme = (id: string): void => {
    if (deps.isApplying()) return;
    deps.persist({ theme: id });
  };
  const selectShell = (id: string): void => {
    if (deps.isApplying()) return;
    deps.persist({ shell: id });
  };
  return { selectTheme, selectShell };
}
