// Emulator-Zustand (Snapshot des WASM-Speichers) in localStorage, gzip-komprimiert.
export const EMU_KEY = "tamagotchi.emu.v1";

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

export async function saveEmu(storage: Storage, state: Uint8Array): Promise<void> {
  const packed = await gzip(state);
  storage.setItem(EMU_KEY, bytesToB64(packed));
}

export async function loadEmu(storage: Storage): Promise<Uint8Array | null> {
  const raw = storage.getItem(EMU_KEY);
  if (!raw) return null;
  try {
    return await gunzip(b64ToBytes(raw));
  } catch {
    return null;
  }
}

export function clearEmu(storage: Storage): void {
  storage.removeItem(EMU_KEY);
}
