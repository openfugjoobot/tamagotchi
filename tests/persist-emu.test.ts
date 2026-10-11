import { describe, it, expect, beforeEach } from "vitest";
import { EMU_KEY, saveEmu, loadEmu, clearEmu } from "@/storage/persist";

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

describe("emu persist", () => {
  it("round-trip erhält die Bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255, 42]);
    saveEmu(st, bytes);
    expect(st.getItem(EMU_KEY)).toBeTruthy();
    expect(Array.from(loadEmu(st)!)).toEqual(Array.from(bytes));
  });
  it("leer ⇒ null; clear entfernt", () => {
    expect(loadEmu(st)).toBeNull();
    saveEmu(st, new Uint8Array([1]));
    clearEmu(st);
    expect(loadEmu(st)).toBeNull();
  });
});
