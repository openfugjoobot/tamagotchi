import { describe, it, expect, beforeEach } from "vitest";
import { emuKey, saveEmu, loadEmu, clearEmu } from "@/storage/persist";

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
  it("round-trip erhält Bytes und Zeitstempel", async () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255, 42]);
    await saveEmu(st, "p1", bytes);
    expect(st.getItem(emuKey("p1"))).toBeTruthy();
    const loaded = await loadEmu(st, "p1");
    expect(Array.from(loaded!.bytes)).toEqual(Array.from(bytes));
    expect(loaded!.at).toBeGreaterThan(0);
  });
  it("leer ⇒ null; clear entfernt", async () => {
    expect(await loadEmu(st, "p1")).toBeNull();
    await saveEmu(st, "p1", new Uint8Array([1]));
    clearEmu(st, "p1");
    expect(await loadEmu(st, "p1")).toBeNull();
  });
});
