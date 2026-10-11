import type { GameState } from "../engine/types";
import { createInitialState, deserialize, serialize } from "../engine/state";

export const SAVE_KEY = "tamagotchi.save.v1";

export function loadState(storage: Storage, nowMs: number, seed: number): GameState {
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) return createInitialState(nowMs, seed);
  try {
    return deserialize(raw);
  } catch {
    return createInitialState(nowMs, seed);
  }
}

export function saveState(storage: Storage, state: GameState): void {
  storage.setItem(SAVE_KEY, serialize(state));
}

export function clearSave(storage: Storage): void {
  storage.removeItem(SAVE_KEY);
}

export function createAutosave(storage: Storage, intervalMs: number) {
  let pending: GameState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (pending) { saveState(storage, pending); pending = null; }
    if (timer) { clearTimeout(timer); timer = null; }
  };
  return {
    schedule(get: () => GameState) {
      pending = get();
      if (timer) return;
      timer = setTimeout(flush, intervalMs);
    },
    flush,
  };
}

// ---- Emulator-Zustand (WASM-Speicher-Snapshot) ----

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
