import { describe, it, expect, beforeEach } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { newDb } from "pg-mem";
import { WebSocket } from "ws";
import { startServer, resolvePublicDir } from "../server/src/main";
import { TickLoop, type PetLike } from "../server/src/tick";
import { collectBeep, beepDebounceSize, resetBeepDebounce } from "../server/src/beeps";
import { signJwt, makeTestKey, jwksFetch, type TestKey } from "./helpers/jwt";
import { verifyIdToken, resetJwksCache } from "../server/src/auth";

/**
 * The entrypoint wires the whole server: schema, pet rehydration, the tick loop,
 * the WebSocket hub, the REST API and the push sweeper. These tests run that
 * wiring against pg-mem (no real Postgres) and a self-built JWKS (no Google),
 * with the real `Repo`, the real API and the real hub — only the WASM pets and
 * the push sender are stubbed, since neither is the subject here.
 */

const CLIENT = "1234.apps.googleusercontent.com";

/** A pg-mem-backed pool shaped like `pg.Pool` (the `Queryable` the Repo wants). */
function memPool() {
  const db = newDb();
  db.public.registerFunction({
    name: "gen_random_uuid",
    returns: "uuid" as never,
    implementation: () => crypto.randomUUID(),
    impure: true,
  });
  return db.adapters.createPg().Pool;
}

/** A minimal live pet, shaped like what the entrypoint stores per pet. */
function fakePet() {
  return {
    steps: 0,
    presses: [] as string[],
    lcd: () => new Uint8Array(512),
    step(ms: number) {
      this.steps += ms;
    },
    press(btn: string) {
      this.presses.push(btn);
    },
    dead: () => false,
    save: () => new Uint8Array(512),
    takeBuzzer: () => false,
  };
}

/** Build a startServer dep set backed by pg-mem, with fakes for WASM/push. */
function baseDeps(pool: unknown, extra: Record<string, unknown> = {}) {
  return {
    pool: pool as never,
    clientId: CLIENT,
    vapid: { subject: "mailto:a@example.com", publicKey: "pub", privateKey: "priv" },
    loadRom: () => new Uint8Array(0),
    loadWasm: () => new Uint8Array(0),
    createPet: () => fakePet() as never,
    startPet: () => fakePet() as never,
    pushIntervalMs: 0,
    ...extra,
  };
}

describe("TickLoop error isolation (Task-3 F1)", () => {
  it("keeps stepping other pets when one pet's step throws", async () => {
    const survivor = fakePet();
    const thrower = {
      ...fakePet(),
      step() {
        throw new Error("boom");
      },
    };
    const errors: unknown[] = [];
    const loop = new TickLoop(() => [thrower as unknown as PetLike, survivor as unknown as PetLike]);
    loop.onError((_pet, err) => errors.push(err));
    loop.start(20);
    await new Promise((r) => setTimeout(r, 120));
    loop.stop();
    // The throwing pet did not kill the loop: the survivor kept advancing and
    // the error was reported instead of escaping the interval.
    expect(survivor.steps).toBeGreaterThan(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("invokes onError with the offending pet when a frame callback throws", async () => {
    const pet = fakePet();
    const errors: unknown[] = [];
    const loop = new TickLoop(() => [pet as unknown as PetLike]);
    loop.onFrame(() => {
      throw new Error("cb boom");
    });
    loop.onError((_pet, err) => errors.push(err));
    loop.start(20);
    await new Promise((r) => setTimeout(r, 80));
    loop.stop();
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("PUBLIC_DIR default resolution (Task-9 N1)", () => {
  it("derives the tree-root public/ from the emitted module location", () => {
    // The compiled module lives at <root>/dist-server/server/src/main.js, i.e.
    // server/src/ three levels below the tree root — both locally and in the
    // Docker image (/app/dist-server/server/src ⇒ /app/public). The old
    // `../../public` default resolved to <root>/dist-server/public and booted
    // nothing; the default must climb three levels.
    const emittedModuleDir = resolve("/app/dist-server/server/src");
    expect(resolvePublicDir({}, emittedModuleDir)).toBe(resolve("/app/public"));
    const localModuleDir = resolve("/repo/dist-server/server/src");
    expect(resolvePublicDir({}, localModuleDir)).toBe(resolve("/repo/public"));
  });

  it("honours an explicit PUBLIC_DIR over the derived default", () => {
    expect(resolvePublicDir({ PUBLIC_DIR: "/custom/assets" }, "/app/dist-server/server/src")).toBe(
      "/custom/assets",
    );
  });

  it("the default lands on the real repo-root public/ that holds the assets", () => {
    // Resolves from this test's own location back to the tree root, then checks
    // the real emitted-layout default points at the assets on disk.
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const moduleDir = resolve(repoRoot, "dist-server/server/src");
    expect(resolvePublicDir({}, moduleDir)).toBe(resolve(repoRoot, "public"));
    expect(existsSync(resolve(repoRoot, "public/emu/rom0.bin"))).toBe(true);
  });
});

describe("startServer wiring", () => {
  // `verifyIdToken` caches Google's JWKS at module level for an hour. Every test
  // here signs with its own key, so without clearing the cache a later test
  // would verify against the first test's key and get 4401 instead of the code
  // it asserts. Reset before each test.
  beforeEach(() => resetJwksCache());

  it("runs the schema, boots, and serves /api/beeps (empty) unauthenticated → 401", async () => {
    resetBeepDebounce();
    const Pool = memPool();
    const srv = await startServer(baseDeps(new Pool()));
    try {
      const res = await fetch(`${srv.url}/api/beeps`);
      expect(res.status).toBe(401);
    } finally {
      await srv.close();
    }
  }, 15000);

  it("rehydrates an existing living pet into the live loop", async () => {
    resetBeepDebounce();
    const Pool = memPool();
    const pool = new Pool();
    const srv = await startServer(baseDeps(pool));
    try {
      // Insert a user + pet through the real Repo, then ask the entrypoint to
      // rehydrate: a fresh startServer over the same DB must pick it up.
      const { Repo } = await import("../server/src/db/repo");
      const repo = new Repo(pool);
      const u = await repo.upsertUser({ sub: "sub-1", email: "a@example.com" });
      await repo.createPet(u.id, "p1");

      await srv.rehydrate();
      expect(srv.livePetIds().length).toBe(1);
    } finally {
      await srv.close();
    }
  }, 15000);

  it("forgets a pet's beep debounce on general teardown (close)", async () => {
    resetBeepDebounce();
    const Pool = memPool();
    const pool = new Pool();
    const srv = await startServer(baseDeps(pool));
    const { Repo } = await import("../server/src/db/repo");
    const repo = new Repo(pool);
    const u = await repo.upsertUser({ sub: "sub-teardown" });
    const pet = await repo.createPet(u.id, "p1");
    await srv.rehydrate();
    expect(srv.livePetIds()).toContain(pet.id);

    // A live beep burst seeds the debounce map keyed by this pet id…
    await collectBeep(repo, pet.id, true, Date.now());
    expect(beepDebounceSize()).toBe(1);

    // …and a general teardown (not only a death) must drop it, so the map does
    // not leak one key per pet that was alive at shutdown (Task-9 minor).
    await srv.close();
    expect(beepDebounceSize()).toBe(0);
  }, 15000);

  it("scopes WS loadPet to its owner: a foreign pet never binds", async () => {
    resetBeepDebounce();
    const Pool = memPool();
    const pool = new Pool();
    const key: TestKey = await makeTestKey();
    const srv = await startServer(
      baseDeps(pool, {
        verify: (token: string, clientId: string) =>
          verifyIdToken(token, clientId, { fetchImpl: jwksFetch(key.jwk), now: Date.now() }),
      }),
    );
    try {
      const { Repo } = await import("../server/src/db/repo");
      const repo = new Repo(pool);
      // user A owns a pet; user B must not be able to bind it.
      const a = await repo.upsertUser({ sub: "sub-A" });
      const pet = await repo.createPet(a.id, "p1");
      await srv.rehydrate();

      const tokenB = await signJwt(key.priv, {
        sub: "sub-B",
        aud: CLIENT,
        iss: "https://accounts.google.com",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const ws = new WebSocket(`${srv.wsUrl}/ws`);
      await new Promise<void>((r) => ws.on("open", () => r()));
      const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
      ws.send(JSON.stringify({ t: "hello", token: tokenB, petId: pet.id }));
      const code = await closed;
      expect(code).toBe(4404); // unknown pet — B does not own it
      expect(srv.hub.hasLiveConnection("sub-B")).toBe(false);
    } finally {
      await srv.close();
    }
  }, 15000);

  it("binds a pet on `hello` when the token carries the Google sub, not the users.id (Task-13 e2e fix)", async () => {
    resetBeepDebounce();
    resetJwksCache();
    const Pool = memPool();
    const pool = new Pool();
    const key: TestKey = await makeTestKey();
    const srv = await startServer(
      baseDeps(pool, {
        verify: (token: string, clientId: string) =>
          verifyIdToken(token, clientId, { fetchImpl: jwksFetch(key.jwk), now: Date.now() }),
      }),
    );
    try {
      const { Repo } = await import("../server/src/db/repo");
      const repo = new Repo(pool);
      const owner = await repo.upsertUser({ sub: "sub-owner" });
      const pet = await repo.createPet(owner.id, "p1");
      await srv.rehydrate();

      // The token carries the Google `sub` (never the internal UUID). The hub
      // must resolve it to `users.id` and scope the pet by that — otherwise
      // every `hello` fails 4404 `unknown pet` (the bug this pins).
      const token = await signJwt(key.priv, {
        sub: "sub-owner",
        aud: CLIENT,
        iss: "https://accounts.google.com",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const ws = new WebSocket(`${srv.wsUrl}/ws`);
      await new Promise<void>((r) => ws.on("open", () => r()));
      const gotState = new Promise<boolean>((r) => {
        ws.on("message", (d) => {
          const m = JSON.parse(String(d));
          if (m.t === "state") r(true);
        });
        setTimeout(() => r(false), 5000);
      });
      ws.send(JSON.stringify({ t: "hello", token, petId: pet.id }));
      expect(await gotState).toBe(true);
      // The push gate is keyed by the internal id, not the sub — a watching
      // user must therefore suppress a push.
      expect(srv.hub.hasLiveConnection(owner.id)).toBe(true);
      ws.close();
    } finally {
      await srv.close();
    }
  }, 15000);

  it("emits state{alive:false} to a watching client when a pet dies (Task-13 §2.1 seam)", async () => {
    // The death-flip emission is correct today only by accident of the
    // `?? false` fallback: `onFrame` deletes the dead pet from `live` *before*
    // `onTickEnd` calls `notifyChanged((petId) => live.get(petId)?.alive ?? false)`.
    // The hub-level test proves the flip with a synthetic `() => pet.alive`; no
    // test drove it through the real `main.ts` wiring where `live.delete()`
    // precedes the lookup. If the fallback (or the delete ordering) ever changes,
    // the watching client silently stops being told the pet died — this pins it.
    resetBeepDebounce();
    resetJwksCache();
    const Pool = memPool();
    const pool = new Pool();
    const key: TestKey = await makeTestKey();

    // A controllable fake: alive on rehydrate, then flips dead for the next tick.
    let isDead = false;
    const dying = {
      ...fakePet(),
      dead: () => isDead,
    };
    const srv = await startServer(
      baseDeps(pool, {
        verify: (token: string, clientId: string) =>
          verifyIdToken(token, clientId, { fetchImpl: jwksFetch(key.jwk), now: Date.now() }),
        createPet: () => dying as never,
      }),
    );
    try {
      const { Repo } = await import("../server/src/db/repo");
      const repo = new Repo(pool);
      const owner = await repo.upsertUser({ sub: "sub-die" });
      const pet = await repo.createPet(owner.id, "p1");
      await srv.rehydrate();
      // Fresh row is alive and the fake reports alive, so the live entry is alive.
      expect(srv.livePetIds()).toContain(pet.id);

      const token = await signJwt(key.priv, {
        sub: "sub-die",
        aud: CLIENT,
        iss: "https://accounts.google.com",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const ws = new WebSocket(`${srv.wsUrl}/ws`);
      await new Promise<void>((r) => ws.on("open", () => r()));
      const states: boolean[] = [];
      const sawAliveFalse = new Promise<boolean>((r) => {
        ws.on("message", (d) => {
          const m = JSON.parse(String(d));
          if (m.t === "state") {
            states.push(m.alive);
            if (m.alive === false) r(true);
          }
        });
        setTimeout(() => r(false), 5000);
      });
      ws.send(JSON.stringify({ t: "hello", token, petId: pet.id }));

      // Wait until the initial living state has been delivered, then flip.
      await new Promise((r) => setTimeout(r, 300));
      expect(states).toContain(true);
      isDead = true;

      // One tick (TICK_MS=125) is enough: onFrame drops the pet from `live`,
      // onTickEnd notifies, and the bound socket must receive alive:false.
      expect(await sawAliveFalse).toBe(true);
      expect(states).toContain(false);
      expect(srv.livePetIds()).not.toContain(pet.id);
      ws.close();
    } finally {
      await srv.close();
    }
  }, 15000);
});
