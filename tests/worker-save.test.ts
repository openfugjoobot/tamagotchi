import { describe, it, expect, beforeEach } from "vitest";
import { handle, type Env } from "@/worker/index";
import { resetJwksCache } from "@/worker/auth";
import { makeTestKey, signJwt, jwksFetch } from "./helpers/jwt";
import type { SaveStore } from "@/worker/store";

const CLIENT = "cid-test";
const BEARER = "Bearer ";
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const URL_SAVE = "https://tamagotchi.fugjoo.com/api/save";

function fakeKv(): { store: SaveStore; map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    store: {
      get: async (k: string) => map.get(k) ?? null,
      put: async (k: string, v: string) => { map.set(k, v); },
      delete: async (k: string) => { map.delete(k); },
    },
  };
}

interface Ctx { env: Env; map: Map<string, string>; deps: { fetchImpl: typeof fetch; now: number }; token: string }

async function ctx(sub = "user-1", shared?: SaveStore): Promise<Ctx> {
  resetJwksCache(); // jeder Kontext hat seinen eigenen Schlüssel
  const k = await makeTestKey();
  const token = await signJwt(k.priv, {
    sub,
    aud: CLIENT,
    iss: "https://accounts.google.com",
    exp: Math.floor(NOW / 1000) + 3600,
  });
  const kv = shared ? { store: shared, map: new Map<string, string>() } : fakeKv();
  return { env: { SAVES: kv.store, GOOGLE_CLIENT_ID: CLIENT }, map: kv.map, deps: { fetchImpl: jwksFetch(k.jwk), now: NOW }, token };
}

function req(method: string, token?: string, body?: string, url = URL_SAVE): Request {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `${BEARER}${token}`;
  return new Request(url, { method, headers, body });
}

const record = (at: string, snapshot = "SNAPSHOT") => JSON.stringify({ snapshot, updatedAt: at, saveVer: 1 });

describe("worker: /api/save", () => {
  beforeEach(() => resetJwksCache());

  it("401 ohne Token", async () => {
    const c = await ctx();
    const res = await handle(req("GET"), c.env, c.deps);
    expect(res.status).toBe(401);
  });

  it("401 bei kaputtem Token", async () => {
    const c = await ctx();
    const res = await handle(req("GET", "nicht.ein.token"), c.env, c.deps);
    expect(res.status).toBe(401);
  });

  it("404 für andere Pfade", async () => {
    const c = await ctx();
    const res = await handle(req("GET", c.token, undefined, "https://tamagotchi.fugjoo.com/api/other"), c.env, c.deps);
    expect(res.status).toBe(404);
  });

  it("404, wenn noch nichts gespeichert ist", async () => {
    const c = await ctx();
    const res = await handle(req("GET", c.token), c.env, c.deps);
    expect(res.status).toBe(404);
  });

  it("PUT speichert und GET liest zurück", async () => {
    const c = await ctx();
    const put = await handle(req("PUT", c.token, record("2026-01-01T12:00:00.000Z")), c.env, c.deps);
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ ok: true });
    const get = await handle(req("GET", c.token), c.env, c.deps);
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({ snapshot: "SNAPSHOT", updatedAt: "2026-01-01T12:00:00.000Z", saveVer: 1 });
    expect([...c.map.keys()]).toEqual(["save:user-1"]);
  });

  it("überschreibt nur, wenn der neue Stand neuer ist (Last-Write-Wins)", async () => {
    const c = await ctx();
    await handle(req("PUT", c.token, record("2026-01-01T12:00:00.000Z", "NEU")), c.env, c.deps);
    const older = await handle(req("PUT", c.token, record("2025-12-31T00:00:00.000Z", "ALT")), c.env, c.deps);
    expect(older.status).toBe(200);
    expect(await older.json()).toMatchObject({ skipped: true });
    const get = await handle(req("GET", c.token), c.env, c.deps);
    expect(await get.json()).toMatchObject({ snapshot: "NEU" });
  });

  it("lehnt kaputten Body ab", async () => {
    const c = await ctx();
    expect((await handle(req("PUT", c.token, "{kaputt"), c.env, c.deps)).status).toBe(400);
    expect((await handle(req("PUT", c.token, JSON.stringify({ snapshot: 1 })), c.env, c.deps)).status).toBe(400);
  });

  it("lehnt zu großen Body ab", async () => {
    const c = await ctx();
    const big = JSON.stringify({ snapshot: "x".repeat(70_000), updatedAt: "2026-01-01T12:00:00.000Z" });
    expect((await handle(req("PUT", c.token, big), c.env, c.deps)).status).toBe(413);
  });

  it("DELETE entfernt den Stand", async () => {
    const c = await ctx();
    await handle(req("PUT", c.token, record("2026-01-01T12:00:00.000Z")), c.env, c.deps);
    expect((await handle(req("DELETE", c.token), c.env, c.deps)).status).toBe(200);
    expect((await handle(req("GET", c.token), c.env, c.deps)).status).toBe(404);
  });

  it("405 für andere Methoden", async () => {
    const c = await ctx();
    expect((await handle(req("POST", c.token, "{}"), c.env, c.deps)).status).toBe(405);
  });

  it("trennt Nutzer über die sub", async () => {
    // WICHTIG: beide Nutzer teilen sich denselben KV-Store. Nur so kann der
    // Test ueberhaupt rot werden, wenn die sub nicht in den Key einfliesst -
    // mit getrennten Maps bestuende er auch bei voellig fehlender Trennung.
    const shared = fakeKv();
    const a = await ctx("user-a", shared.store);
    const b = await ctx("user-b", shared.store);
    await handle(req("PUT", a.token, record("2026-01-01T12:00:00.000Z", "A")), a.env, a.deps);
    resetJwksCache(); // im Test hat jeder Kontext einen eigenen Schlüssel
    // B darf A's Stand nicht sehen.
    expect((await handle(req("GET", b.token), b.env, b.deps)).status).toBe(404);
    // Und der Schreibvorgang muss tatsaechlich im gemeinsamen Store gelandet
    // sein - sonst prueft der 404 oben nichts.
    expect([...shared.map.keys()]).toEqual(["save:user-a"]);
  });
});
