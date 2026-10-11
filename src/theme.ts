// Hintergrund-Themes, geteilt zwischen Start- und Guide-Seite.
import { BG_KEY } from "./storage/keys";
export { BG_KEY };

export interface Theme {
  id: string;
  /** Swatch im Menü – Hex-Farbe oder CSS-Gradient. */
  c: string;
}

export const AUTO = "auto";

export const THEMES: Theme[] = [
  { id: "blossom", c: "#ffc2d6" },
  { id: "day", c: "#bcd7ff" },
  { id: "dusk", c: "#e08a5a" },
  { id: "night", c: "#14233a" },
  { id: "midnight", c: "#05060a" },
  { id: AUTO, c: "linear-gradient(135deg, #ffc2d6 0%, #bcd7ff 30%, #e08a5a 62%, #14233a 100%)" },
];

export const THEME_IDS: string[] = THEMES.map((t) => t.id);

/** Tageszeit → Theme (nach lokaler Uhrzeit des Geräts). */
export function phaseForHour(hour: number): string {
  if (hour >= 5 && hour < 9) return "blossom"; // Morgen
  if (hour >= 9 && hour < 17) return "day"; // Tag
  if (hour >= 17 && hour < 20) return "dusk"; // Abend
  if (hour >= 20 && hour < 23) return "night"; // später Abend
  return "midnight"; // Nacht
}

/** Gespeicherte Auswahl (validiert) – ohne Auswahl ist "auto" der Default. */
export function savedBg(storage: Storage): string {
  try {
    const v = storage.getItem(BG_KEY);
    return v && THEME_IDS.includes(v) ? v : AUTO;
  } catch {
    return AUTO;
  }
}

/** Anzuzeigendes Theme – "auto" wird nach Tageszeit aufgelöst. */
export function resolveTheme(id: string, now: Date = new Date()): string {
  return id === AUTO ? phaseForHour(now.getHours()) : id;
}
