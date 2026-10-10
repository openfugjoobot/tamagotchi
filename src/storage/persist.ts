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
