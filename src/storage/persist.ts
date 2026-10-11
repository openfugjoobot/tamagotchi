// Emulator-Zustand (Snapshot des WASM-Speichers) in localStorage.
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

export function saveEmu(storage: Storage, state: Uint8Array): void {
  storage.setItem(EMU_KEY, bytesToB64(state));
}

export function loadEmu(storage: Storage): Uint8Array | null {
  const raw = storage.getItem(EMU_KEY);
  if (!raw) return null;
  try {
    return b64ToBytes(raw);
  } catch {
    return null;
  }
}

export function clearEmu(storage: Storage): void {
  storage.removeItem(EMU_KEY);
}
