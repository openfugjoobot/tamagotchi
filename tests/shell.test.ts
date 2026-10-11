import { describe, it, expect } from "vitest";
import { SHELLS, SHELL_KEY, applyShell, savedShell } from "@/shell";

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

function fakeDevice(): HTMLElement {
  return { dataset: {} as DOMStringMap } as HTMLElement;
}

describe("shell", () => {
  it("hat 9 Varianten mit eindeutigen IDs", () => {
    const ids = SHELLS.map((s) => s.id);
    expect(ids.length).toBe(9);
    expect(new Set(ids).size).toBe(9);
  });
  it("applyShell setzt Attribut und speichert", () => {
    const st = memStorage();
    const dev = fakeDevice();
    applyShell(dev, "pink", st);
    expect(dev.dataset.shell).toBe("pink");
    expect(st.getItem(SHELL_KEY)).toBe("pink");
  });
  it("unbekannte ID fällt auf teal zurück", () => {
    const dev = fakeDevice();
    applyShell(dev, "nope");
    expect(dev.dataset.shell).toBe("teal");
  });
  it("savedShell liest gültige Werte", () => {
    const st = memStorage();
    st.setItem(SHELL_KEY, "purple");
    expect(savedShell(st)).toBe("purple");
    st.setItem(SHELL_KEY, "bogus");
    expect(savedShell(st)).toBe("teal");
  });
});
