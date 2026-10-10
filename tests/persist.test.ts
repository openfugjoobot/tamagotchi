import { describe, it, expect, beforeEach } from "vitest";
import { SAVE_KEY, loadState, saveState, clearSave } from "@/storage/persist";
import { createInitialState } from "@/engine/state";

function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, v) => { map.set(k, v); },
  } as Storage;
}

let st: Storage;
beforeEach(() => { st = memStorage(); });

describe("persist", () => {
  it("erzeugt Initialzustand wenn leer", () => {
    const s = loadState(st, 1000, 42);
    expect(s.stage).toBe("EGG");
  });
  it("speichert und lädt wieder", () => {
    const s = { ...createInitialState(1000, 42), hungry: 1 };
    saveState(st, s);
    expect(st.getItem(SAVE_KEY)).toBeTruthy();
    expect(loadState(st, 2000, 42).hungry).toBe(1);
  });
  it("clearSave entfernt Eintrag", () => {
    saveState(st, createInitialState(1000, 42));
    clearSave(st);
    expect(st.getItem(SAVE_KEY)).toBeNull();
  });
  it("korrupter Save fällt auf Initialzustand zurück", () => {
    st.setItem(SAVE_KEY, "kaputt");
    expect(loadState(st, 1000, 42).stage).toBe("EGG");
  });
});
