import { describe, it, expect, beforeEach } from "vitest";
import { setSession, restoreSession, currentSession, signOut, type Session } from "@/auth/google";
import { IDTOKEN_KEY } from "@/storage/keys";

// Minimal-Storage-Stubs, damit der Test ohne jsdom laeuft.
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

const future = (): Session => ({
  token: "tok",
  exp: Date.now() + 60 * 60 * 1000,
  email: "a@b.c",
  name: "Ann",
});

describe("google-Session", () => {
  let local: Storage;
  let session: Storage;
  beforeEach(() => {
    local = memStorage();
    session = memStorage();
    (globalThis as unknown as { localStorage: Storage }).localStorage = local;
    (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = session;
    // window/document sind in Node nicht vorhanden (signOut nutzt window.google).
    (globalThis as unknown as { window: unknown }).window = {};
    (globalThis as unknown as { document: unknown }).document = { createElement: () => ({}), head: { appendChild: () => {} } };
    signOut();
  });

  it("legt die Session in localStorage ab (ueberlebt das Schliessen des Tabs)", () => {
    setSession(future());
    expect(local.getItem(IDTOKEN_KEY)).toBeTruthy();
    expect(session.getItem(IDTOKEN_KEY)).toBeNull();
  });

  it("stellt die Session aus localStorage wieder her", () => {
    const s = future();
    local.setItem(IDTOKEN_KEY, JSON.stringify(s));
    expect(currentSession()).toBeNull();
    const got = restoreSession();
    expect(got?.token).toBe("tok");
  });

  it("verwirft abgelaufene Tokens", () => {
    local.setItem(IDTOKEN_KEY, JSON.stringify({ token: "old", exp: Date.now() - 1000 }));
    expect(restoreSession()).toBeNull();
    expect(local.getItem(IDTOKEN_KEY)).toBeNull();
  });

  it("migriert einen alten sessionStorage-Eintrag einmalig", () => {
    const s = future();
    session.setItem("tamagotchi.idtoken", JSON.stringify(s));
    const got = restoreSession();
    expect(got?.token).toBe("tok");
    expect(local.getItem(IDTOKEN_KEY)).toBeTruthy();
    expect(session.getItem("tamagotchi.idtoken")).toBeNull();
  });

  it("signOut entfernt die Session", () => {
    setSession(future());
    signOut();
    expect(currentSession()).toBeNull();
    expect(local.getItem(IDTOKEN_KEY)).toBeNull();
  });
});
