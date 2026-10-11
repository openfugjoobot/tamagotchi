export interface Shell {
  id: string;
  /** Vorschau-Farben (oben/unten) für den Swatch. */
  top: string;
  bot: string;
}

export const SHELLS: Shell[] = [
  { id: "teal",   top: "#2ad3c8", bot: "#0f9a94" },
  { id: "pink",   top: "#ff8fc7", bot: "#e0447f" },
  { id: "blue",   top: "#6fb6ff", bot: "#2f6fd0" },
  { id: "purple", top: "#b98cff", bot: "#6b3fc9" },
  { id: "sunset", top: "#ffb066", bot: "#e0563f" },
  { id: "mono",   top: "#3a3f47", bot: "#16181d" },
];

import { SHELL_KEY } from "./storage/keys";
export { SHELL_KEY };

export function applyShell(device: HTMLElement, id: string, storage?: Storage): void {
  const s = SHELLS.find((x) => x.id === id) ?? SHELLS[0];
  device.dataset.shell = s.id;
  try { storage?.setItem(SHELL_KEY, s.id); } catch { /* ignore */ }
}

export function savedShell(storage: Storage): string {
  try {
    const v = storage.getItem(SHELL_KEY);
    return v && SHELLS.some((s) => s.id === v) ? v : "teal";
  } catch {
    return "teal";
  }
}
