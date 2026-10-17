/**
 * Settings bound to `/api/settings` (spec §3: settings live on the user, not in
 * localStorage).
 *
 * The server owns the values; this module reads them, renders a form, and
 * writes changes back with a partial `PUT`. It is intentionally tiny and
 * DOM-light: `applySettings()` merges a loaded payload into the local UI state
 * and `savePatch()` persists a change, both pure enough to reason about.
 *
 * Keys mirror the server's allow-list (`server/src/api.ts` SETTINGS_DEFAULTS):
 * theme, lang, shell, sound, push.
 */

import { api } from "./api";

export interface Settings {
  theme: string;
  lang: string;
  shell: string;
  sound: boolean;
  push: boolean;
}

/** The settings a fresh user starts with — mirrors the server defaults. */
export const SETTINGS_DEFAULTS: Settings = {
  theme: "light",
  lang: "de",
  shell: "green",
  sound: true,
  push: true,
};

/** Coerce an unknown payload into a Settings object, filling missing keys. */
export function normalizeSettings(raw: unknown): Settings {
  const out: Settings = { ...SETTINGS_DEFAULTS };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    if (typeof r.theme === "string") out.theme = r.theme;
    if (typeof r.lang === "string") out.lang = r.lang;
    if (typeof r.shell === "string") out.shell = r.shell;
    if (typeof r.sound === "boolean") out.sound = r.sound;
    if (typeof r.push === "boolean") out.push = r.push;
  }
  return out;
}

export interface SettingsDeps {
  token: () => string | null;
  /** Called with the merged settings after a successful load/save. */
  onApply?: (s: Settings) => void;
  /** A user-facing message channel (the app's toast). */
  notify?: (msg: string) => void;
  /** i18n message for a save failure. Defaults to the dict lookup. */
  failMessage?: () => string;
}

export interface SettingsView {
  load(): Promise<Settings>;
  save(patch: Partial<Settings>): Promise<boolean>;
}

export function createSettingsView(deps: SettingsDeps): SettingsView {
  const load = async (): Promise<Settings> => {
    const res = await api.get<Settings>("/api/settings", deps.token());
    const s = normalizeSettings(res.ok ? res.data : null);
    deps.onApply?.(s);
    return s;
  };

  const save = async (patch: Partial<Settings>): Promise<boolean> => {
    const res = await api.put<Settings>("/api/settings", deps.token(), patch);
    if (res.ok) {
      deps.onApply?.(normalizeSettings(res.data));
      return true;
    }
    deps.notify?.(deps.failMessage?.() ?? "");
    return false;
  };

  return { load, save };
}
