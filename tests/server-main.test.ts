import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { newDb } from "pg-mem";
import { WebSocket } from "ws";
import { startServer, resolvePublicDir } from "../server/src/main";
import { TickLoop, type PetLike } from "../server/src/tick";
import { collectBeep, beepDebounceSize, resetBeepDebounce } from "../server/src/beeps";
import { signJwt, makeTestKey, jwksFetch, type TestKey } from "./helpers/jwt";
import { verifyIdToken } from "../server/src/auth";

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
});
