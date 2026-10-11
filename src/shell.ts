export interface ShellShape {
  /** Zacken des Sterns um den Screen. */
  points: number;
  /** Innenradius relativ zum Außenradius (0–1). */
  inner: number;
  /** Startdrehung in Grad. */
  rot: number;
}

export interface Shell {
  id: string;
  /** Vorschau-Farben (oben/unten) für den Swatch. */
  top: string;
  bot: string;
  /** Form des Sterns um den Screen. */
  star: ShellShape;
}

export const SHELLS: Shell[] = [
  { id: "teal",   top: "#2ad3c8", bot: "#0f9a94", star: { points: 18, inner: 0.82, rot: 0 } },
  { id: "pink",   top: "#ff8fc7", bot: "#e0447f", star: { points: 10, inner: 0.66, rot: 9 } },
  { id: "blue",   top: "#6fb6ff", bot: "#2f6fd0", star: { points: 14, inner: 0.86, rot: 6 } },
  { id: "purple", top: "#b98cff", bot: "#6b3fc9", star: { points: 7,  inner: 0.58, rot: 12 } },
  { id: "sunset", top: "#ffb066", bot: "#e0563f", star: { points: 22, inner: 0.90, rot: 0 } },
  { id: "mono",   top: "#3a3f47", bot: "#16181d", star: { points: 5,  inner: 0.50, rot: 0 } },
];

/** Polygon-Punkte ("x,y …") für einen Stern im 100×100-Raster. */
export function starPolygon(shape: ShellShape, cx = 50, cy = 50, r = 50): string {
  const n = Math.max(3, Math.round(shape.points));
  const step = Math.PI / n;
  const out: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const rr = i % 2 === 0 ? r : r * shape.inner;
    const a = -Math.PI / 2 + (shape.rot * Math.PI) / 180 + i * step;
    out.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return out.join(" ");
}

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
