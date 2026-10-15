import { describe, it, expect, beforeEach } from "vitest";
import { emuKey, migrateLegacyEmu, saveEmu, loadEmu } from "@/storage/persist";
import { EMU_KEY_LEGACY, EMU_KEY_P1, EMU_KEY_P2 } from "@/storage/keys";

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, v); },
  } as Storage;
}

describe("Spielstand pro Geraet", () => {
  let s: Storage;
  beforeEach(() => { s = memStorage(); });

  it("gibt jedem Geraet einen eigenen Schluessel", () => {
    expect(emuKey("p1")).toBe(EMU_KEY_P1);
    expect(emuKey("p2")).toBe(EMU_KEY_P2);
  });

  it("trennt die Staende von P1 und P2", async () => {
    await saveEmu(s, "p1", new Uint8Array([1, 2, 3]));
    await saveEmu(s, "p2", new Uint8Array([9, 9, 9]));
    expect((await loadEmu(s, "p1"))?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect((await loadEmu(s, "p2"))?.bytes).toEqual(new Uint8Array([9, 9, 9]));
  });

  it("hebt den alten Schluessel auf den P1-Slot", () => {
    s.setItem(EMU_KEY_LEGACY, JSON.stringify({ t: 123, d: "ALT" }));
    migrateLegacyEmu(s);
    expect(s.getItem(EMU_KEY_P1)).toBe(JSON.stringify({ t: 123, d: "ALT" }));
    expect(s.getItem(EMU_KEY_LEGACY)).toBeNull();
  });

  it("laesst einen vorhandenen P1-Slot unangetastet", () => {
    s.setItem(EMU_KEY_LEGACY, JSON.stringify({ t: 1, d: "ALT" }));
    s.setItem(EMU_KEY_P1, JSON.stringify({ t: 2, d: "NEU" }));
    migrateLegacyEmu(s);
    expect(s.getItem(EMU_KEY_P1)).toBe(JSON.stringify({ t: 2, d: "NEU" }));
  });

  it("laesst P2 beim Migrieren leer", () => {
    s.setItem(EMU_KEY_LEGACY, JSON.stringify({ t: 1, d: "ALT" }));
    migrateLegacyEmu(s);
    expect(s.getItem(EMU_KEY_P2)).toBeNull();
  });
});
