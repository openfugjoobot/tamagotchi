// Emulator-Zustand (Snapshot des WASM-Speichers) in localStorage, gzip-komprimiert.
import { EMU_KEY } from "./keys";
export { EMU_KEY };

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

/** Roher gespeicherter Datensatz (ohne Dekomprimieren) – für den Cloud-Abgleich. */
export function readSaveRecord(storage: Storage): { d: string; t: number } | null {
  try {
    const raw = storage.getItem(EMU_KEY);
    if (!raw || !raw.startsWith("{")) return null;
    const o = JSON.parse(raw) as { t?: number; d?: string };
    return typeof o.d === "string" && typeof o.t === "number" ? { d: o.d, t: o.t } : null;
  } catch {
    return null;
  }
}

export async function saveEmu(storage: Storage, state: Uint8Array): Promise<void> {
  const packed = await gzip(state);
  storage.setItem(EMU_KEY, JSON.stringify({ t: Date.now(), d: bytesToB64(packed) }));
}

export async function loadEmu(storage: Storage): Promise<LoadedEmu | null> {
  const raw = storage.getItem(EMU_KEY);
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

export function clearEmu(storage: Storage): void {
  storage.removeItem(EMU_KEY);
}
