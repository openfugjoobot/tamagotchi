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

export const DEVICE_IDS: Device[] = ["p1", "p2"];
