// Emulator-Zustand (Snapshot des WASM-Speichers) in localStorage, gzip-komprimiert.
import { EMU_KEY_LEGACY, EMU_KEY_P1, EMU_KEY_P2 } from "./keys";
import type { Device } from "../emu/devices";

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return data;
  const cs = new CompressionStream("gzip");
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(cs as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") return data;
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(ds as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface LoadedEmu { bytes: Uint8Array; at: number }

/** Schluessel des Spielstands fuer ein Geraet. */
export function emuKey(device: Device): string {
  return device === "p2" ? EMU_KEY_P2 : EMU_KEY_P1;
}

/**
 * Einmalig: den Stand von vor dem P1/P2-Umbau auf den P1-Slot heben.
 *
 * Der alte Schluessel gehoert P1 - P2 gab es vorher nicht. Ein bereits
 * vorhandener P1-Slot gewinnt, damit ein zweiter Aufruf nichts ueberschreibt.
 */
export function migrateLegacyEmu(storage: Storage): void {
  try {
    const legacy = storage.getItem(EMU_KEY_LEGACY);
    if (!legacy) return;
    if (storage.getItem(EMU_KEY_P1)) { storage.removeItem(EMU_KEY_LEGACY); return; }
    storage.setItem(EMU_KEY_P1, legacy);
    storage.removeItem(EMU_KEY_LEGACY);
  } catch {
    /* Quota: dann bleibt der alte Schluessel liegen */
  }
}

/** Roher gespeicherter Datensatz (ohne Dekomprimieren) – für den Cloud-Abgleich. */
export function readSaveRecord(storage: Storage, device: Device): { d: string; t: number } | null {
  try {
    const raw = storage.getItem(emuKey(device));
    if (!raw || !raw.startsWith("{")) return null;
    const o = JSON.parse(raw) as { t?: number; d?: string };
    return typeof o.d === "string" && typeof o.t === "number" ? { d: o.d, t: o.t } : null;
  } catch {
    return null;
  }
}

export async function saveEmu(storage: Storage, device: Device, state: Uint8Array): Promise<void> {
  const packed = await gzip(state);
  storage.setItem(emuKey(device), JSON.stringify({ t: Date.now(), d: bytesToB64(packed) }));
}

export async function loadEmu(storage: Storage, device: Device): Promise<LoadedEmu | null> {
  const raw = storage.getItem(emuKey(device));
  if (!raw) return null;
  try {
    if (raw.startsWith("{")) {
      const o = JSON.parse(raw) as { t: number; d: string };
      return { bytes: await gunzip(b64ToBytes(o.d)), at: o.t };
    }
    // Legacy-Format (ohne Zeitstempel)
    return { bytes: await gunzip(b64ToBytes(raw)), at: 0 };
  } catch {
    return null;
  }
}

export function clearEmu(storage: Storage, device: Device): void {
  storage.removeItem(emuKey(device));
}
