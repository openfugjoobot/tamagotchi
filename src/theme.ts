// Hintergrund-Themes, geteilt zwischen Start- und Guide-Seite.
import { BG_KEY } from "./storage/keys";
export { BG_KEY };

export interface Theme {
  id: string;
  /** Swatch-Farbe im Menü. */
  c: string;
}

export const THEMES: Theme[] = [
  { id: "day", c: "#bcd7ff" },
  { id: "blossom", c: "#ffc2d6" },
  { id: "forest", c: "#cfe6cf" },
  { id: "dusk", c: "#e08a5a" },
  { id: "night", c: "#14233a" },
  { id: "midnight", c: "#05060a" },
];

export const THEME_IDS: string[] = THEMES.map((t) => t.id);

/** Gespeichertes Theme (validiert) oder "day". */
export function savedBg(storage: Storage): string {
  try {
    const v = storage.getItem(BG_KEY);
    return v && THEME_IDS.includes(v) ? v : "day";
  } catch {
    return "day";
  }
}
