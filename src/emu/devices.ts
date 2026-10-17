/** Welche Tamagotchi-Generation laeuft. */
export type Device = "p1" | "p2";

export interface DeviceSpec {
  id: Device;
  /** Kurzlabel im Titel-Umschalter. */
  label: string;
  /** ROM-Pfad unter public/. */
  rom: string;
  /** Ausgeschriebener Name (Titel, aria-label). */
  name: string;
}

export const DEVICES: Record<Device, DeviceSpec> = {
  p1: { id: "p1", label: "P1", rom: "/emu/rom0.bin", name: "Tamagotchi P1" },
  p2: { id: "p2", label: "P2", rom: "/emu/rom2.bin", name: "Tamagotchi P2" },
};

/** Startgeraet aus dem gespeicherten Wert; P2 nur, wenn sein ROM geladen ist. */
export function pickInitialDevice(
  saved: string | null,
  opts: { p2Available?: boolean } = {},
): Device {
  if (saved !== "p2") return "p1";
  return opts.p2Available === false ? "p1" : "p2";
}

/** Beschriftung des Titel-Schalters: zeigt das aktuell aktive Geraet. */
export function switchLabel(current: Device): string {
  return DEVICES[current].label;
}

/**
 * Naechstes Geraet beim Klick auf den Titel-Schalter.
 *
 * Ohne P2 bleibt es bei P1 - der Schalter soll nicht ins Leere fuehren.
 */
export function nextDevice(current: Device, opts: { p2Available?: boolean } = {}): Device {
  if (opts.p2Available === false) return "p1";
  return current === "p1" ? "p2" : "p1";
}
