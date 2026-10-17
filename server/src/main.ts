/**
 * Server entrypoint — wires every piece into one running process.
 *
 * Boot order (spec §9):
 *   1. read configuration from the environment (Postgres URL, Google client id,
 *      VAPID keys, port);
 *   2. connect to Postgres and run `schema.sql` (idempotent on every boot);
 *   3. rehydrate every **living** pet from `pets.state` and catch it up by the
 *      real wall-clock time since `last_tick_at` — a pet keeps aging while the
 *      server is down;
 *   4. start the single `TickLoop` at 125 ms (8 fps, the browser's frame rate)
 *      and attach the `WsHub` so frames flow out and buttons flow in;
 *   5. register the REST API and start the push sweeper on an interval.
 *
 * Everything that touches the outside world (Postgres pool, ROM/WASM bytes,
 * push sender, clock) is injectable via `startServer`, so the whole wiring runs
 * under pg-mem in `tests/server-main.test.ts` without Postgres, WASM or network.
 * `main()` reads the real environment and calls `startServer` with real deps.
 *
 * Runtime imports use relative specifiers (`./api.js`, `../../src/emu/*`), not
 * the vitest/tsconfig-only `@` alias, so plain `node dist-server/server/src/main.js`
 * works (Task-3 F2). The published build emits ESM, hence the `.js` suffixes.
 */
import { existsSync, readFileSync } from "node:fs";
import { type Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { Pool } from "pg";
import Fastify, { type FastifyInstance } from "fastify";
import { Repo } from "./db/repo.js";
import { registerApi } from "./api.js";
import { WsHub, type LoadedPet } from "./ws.js";
import { TickLoop, type PetLike } from "./tick.js";
import { PetEmulator } from "./emulator.js";
import { collectBeep, forgetPet } from "./beeps.js";
import { webPushSender, sendPendingPush, type PushSender } from "./push.js";
import { verifyIdToken, type TokenClaims } from "./auth.js";

/** How often the tick loop advances every pet (8 fps, matches the browser). */
export const TICK_MS = 125;
/** How often the push sweeper drains pending beeps. */
export const PUSH_SWEEP_MS = 30_000;

/** A live pet plus the bookkeeping the entrypoint keeps per pet id. */
interface LiveEntry {
  id: string;
  pet: PetEmulator;
  userId: string;
  device: string;
  alive: boolean;
  /** Last tick time actually written to the DB (throttles writes). */
  lastSavedAt: number;
}

export interface VapidConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export interface StartServerDeps {
  /** A `pg.Pool`-shaped object (real `pg.Pool` or pg-mem). */
  pool: { query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }> };
  clientId: string;
  vapid: VapidConfig;
  /** ROM and WASM bytes. Injectable so tests need no copyrighted firmware. */
  loadRom: (device: string) => Uint8Array;
  loadWasm: () => Uint8Array;
  /**
   * Build a live pet from ROM/WASM/state. Defaults to a real `PetEmulator`.
   * Injectable so the wiring tests can supply fakes without WASM (or the
   * copyrighted firmware).
   */
  createPet?: (rom: Uint8Array, wasm: Uint8Array, state?: Uint8Array) => PetEmulator;
  /** Path to `schema.sql`; defaults to the sibling file next to this module. */
  schemaPath?: string;
  /**
   * Build the live pet for a row the API just created. Defaults to assembling a
   * real `PetEmulator` from `createPet`; injectable so tests can hand over a
   * fake. Return `void` to fall back to the default (`createPet`).
   */
  startPet?: (userId: string, petId: string) => PetEmulator | void;
  /** Push sender; defaults to the `web-push`-backed sender (Task-7 F3). */
  sender?: PushSender;
  /** Token verifier; defaults to the real Google JWKS verifier. */
  verify?: (token: string, clientId: string) => Promise<TokenClaims>;
  port?: number;
  /** Sweeper interval; `0` disables it (tests). */
  pushIntervalMs?: number;
}

/** Handle returned by `startServer`, exposing the live pieces for tests/CLI. */
export interface ServerHandle {
  app: FastifyInstance;
  http: HttpServer;
  hub: WsHub;
  loop: TickLoop;
  repo: Repo;
  url: string;
  wsUrl: string;
  /** Re-read the DB and (re)build the live-pet set. */
  rehydrate(): Promise<void>;
  /** Ids of pets currently live in the tick loop. */
  livePetIds(): string[];
  close(): Promise<void>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Where `emu/rom0.bin`, `emu/rom2.bin` and `emu/tamalib.wasm` live.
 *
 * `PUBLIC_DIR` wins when set. Otherwise the default is derived from this
 * module's own location rather than hard-coded, so it is correct for the
 * emitted layout wherever the tree is deployed: the compiled module sits at
 * `<root>/dist-server/server/src/main.js` and the static assets at
 * `<root>/public/emu/` — locally (repo-root `public/`) and in the Docker image
 * (`/app/public/`, Dockerfile `COPY public/emu ./public/emu`). Three levels up
 * from `server/src/` is the tree root in both cases (Task-9 N1).
 */
export function resolvePublicDir(env: { PUBLIC_DIR?: string }, moduleDir: string = __dirname): string {
  return env.PUBLIC_DIR ?? resolve(moduleDir, "../../../public");
}

/** How long a pet may run unsaved before its state is written back. */
const SAVE_EVERY_MS = 60_000;

/**
 * Wire and start the whole server. Returns when it is listening.
 */
export async function startServer(deps: StartServerDeps): Promise<ServerHandle> {
  const repo = new Repo(deps.pool);
  const verify = deps.verify ?? verifyIdToken;

  // 1. schema — idempotent, safe to run on every boot.
  const schemaPath = deps.schemaPath ?? resolve(__dirname, "db/schema.sql");
  await deps.pool.query(readFileSync(schemaPath, "utf8"));

  // 2. live pets, keyed by id. Frames are produced here. `petIndex` maps a pet
  //    instance back to its entry so the per-frame hook is O(1), not O(n).
  const live = new Map<string, LiveEntry>();
  const petIndex = new WeakMap<PetLike, LiveEntry>();

  const loop = new TickLoop(() => [...live.values()].map((e) => e.pet));
  loop.onError((_pet, err) => {
    // One pet failing must never take the server down; log and continue.
    console.error("[tick] pet step failed:", err);
  });

  // 3. hub — frames out, buttons in. `loadPet` is user-scoped (Task-6 Finding A).
  const hub = new WsHub({
    verify,
    clientId: deps.clientId,
    loadPet: async (sub, petId): Promise<LoadedPet> => {
      // `hello` carries the Google `sub` (from the verified token), not our
      // internal `users.id`. Resolve it to the internal id first — exactly like
      // the REST API does — so `repo.getPet` (where id=$1 and user_id=$2) is
      // scoped by the real owner. Passing the raw `sub` as `user_id` matched
      // nothing and made every `hello` fail with 4404 `unknown pet`.
      const user = await repo.upsertUser({ sub });
      const row = await repo.getPet(user.id, petId); // where id=$1 and user_id=$2
      if (!row) throw new Error("unknown pet");
      const entry = live.get(petId);
      if (!entry) throw new Error("pet not live");
      return { pet: entry.pet, alive: row.alive, ageYears: row.age_years, userId: user.id };
    },
  });

  const app = Fastify();
  registerApi(app, {
    repo,
    verify,
    clientId: deps.clientId,
    startPet: (userId, petId) => {
      // Bring the freshly created row up as a live pet, using its real device
      // (the API allowed p1 or p2), not a hard-coded one.
      void hydrateById(userId, petId);
    },
    loadSlot: (userId, petId, slot) => {
      // The API already proved the pet and slot belong to the user and share a
      // device. Restore the bytes into the live emulator and persist the new
      // state. If the pet is not live (it died and was dropped), bring it back
      // first so the loaded snapshot actually ticks.
      void restoreSlot(userId, petId, slot.snapshot);
    },
  });
  // Attach the WS hub to Fastify's own HTTP server before listening: Fastify
  // owns the socket, so we must not wrap it in a second `createServer`.
  hub.attach(app.server);

  const sender =
    deps.sender ??
    buildWebPushSender(deps.vapid);

  /** Bring a pet row up as a live emulator, catching up its offline time. */
  async function hydrate(row: {
    id: string;
    user_id: string;
    device: string;
    state: Buffer | null;
    alive: boolean;
    last_tick_at: Date;
  }): Promise<void> {
    const rom = deps.loadRom(row.device);
    const wasm = deps.loadWasm();
    const makePet = deps.createPet ?? ((r, w, s) => new PetEmulator(r, w, s));
    const pet = makePet(rom, wasm, row.state ? new Uint8Array(row.state) : undefined);
    // Catch-up: advance by the real time elapsed since the last tick, in capped
    // slices so a long outage does not become one enormous synchronous burst.
    const elapsed = Math.max(0, Date.now() - new Date(row.last_tick_at).getTime());
    stepInSlices(pet, elapsed);
    const entry: LiveEntry = {
      id: row.id,
      pet,
      userId: row.user_id,
      device: row.device,
      alive: row.alive && !pet.dead(),
      lastSavedAt: Date.now(),
    };
    live.set(row.id, entry);
    petIndex.set(pet, entry);
  }

  async function rehydrate(): Promise<void> {
    const pets = await repo.listLivingPets();
    live.clear();
    for (const row of pets) await hydrate(row);
  }

  /** Bring one specific pet (by id, for its owner) up as a live emulator. */
  async function hydrateById(userId: string, petId: string): Promise<void> {
    const row = await repo.getPet(userId, petId);
    if (!row) return;
    // A freshly-created pet has no saved state yet; `createPet` builds one. The
    // injected `createPet` lets tests hand over a fake instead of real WASM.
    if (deps.startPet) {
      const pet = deps.startPet(userId, petId) as PetEmulator;
      const entry: LiveEntry = {
        id: petId,
        pet,
        userId,
        device: row.device,
        alive: true,
        lastSavedAt: 0,
      };
      live.set(petId, entry);
      petIndex.set(entry.pet, entry);
      return;
    }
    await hydrate(row);
  }

  /**
   * Load a save-slot snapshot into a pet and persist it. The API has already
   * checked ownership and device; here we touch the running emulator. A pet that
   * died earlier is no longer in `live`, so hydrate it first (from its current
   * DB state) and then overwrite that state with the loaded snapshot — the slot
   * must actually tick, not sit inert.
   */
  async function restoreSlot(userId: string, petId: string, snapshot: Uint8Array): Promise<void> {
    if (!live.has(petId)) await hydrateById(userId, petId);
    const entry = live.get(petId);
    if (!entry) return; // pet vanished between the ownership check and here
    entry.pet.loadState(snapshot);
    // A loaded state can be the angel frame; latch the truth and never resurrect
    // a dead pet just because a slot was loaded.
    const alive = !entry.pet.dead();
    entry.alive = alive;
    entry.lastSavedAt = Date.now();
    await repo.savePetState(petId, entry.pet.save(), alive, alive ? null : new Date());
  }

  await rehydrate();
  loop.start(TICK_MS);

  // 4. per-tick housekeeping: record beeps, persist state, drop dead pets, and
  //    (once per tick, not per pet) push changed frames + state flips to clients.
  loop.onFrame((pet, _lcd) => {
    const entry = petIndex.get(pet);
    if (!entry) return;
    const id = entry.id;
    // Beep latch → debounced row (Task-7 F4: collectBeep now has a caller).
    void collectBeep(repo, id, entry.pet.takeBuzzer(), Date.now()).catch((err) =>
      console.error("[beep] record failed:", err),
    );
    // Persist state periodically so a restart loses at most SAVE_EVERY_MS.
    if (Date.now() - entry.lastSavedAt >= SAVE_EVERY_MS) {
      entry.lastSavedAt = Date.now();
      const alive = !entry.pet.dead();
      void repo
        .savePetState(id, entry.pet.save(), alive, alive ? null : new Date())
        .catch((err) => console.error("[save] persist failed:", err));
    }
    // Dead pets: persist once, then stop ticking and forget the debounce
    // (Task-7 F4: forgetPet needs a real caller or the map leaks).
    if (entry.pet.dead() && entry.alive) {
      entry.alive = false;
      void repo.savePetState(id, entry.pet.save(), false, new Date()).catch(() => {});
      live.delete(id);
      forgetPet(id);
    }
  });
  loop.onTickEnd(() => {
    hub.notifyChanged((petId) => live.get(petId)?.alive ?? false);
  });

  // 5. push sweeper.
  let sweepTimer: ReturnType<typeof setInterval> | null = null;
  const sweep = async (): Promise<void> => {
    try {
      await sendPendingPush({ repo, sender, hasLiveConnection: (u) => hub.hasLiveConnection(u), vapid: deps.vapid });
    } catch (err) {
      console.error("[push] sweep failed:", err);
    }
  };
  const sweepMs = deps.pushIntervalMs ?? PUSH_SWEEP_MS;
  if (sweepMs > 0) sweepTimer = setInterval(() => void sweep(), sweepMs);

  const port = deps.port ?? 0;
  await app.listen({ port, host: "127.0.0.1" });
  const addr = app.server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  const url = `http://127.0.0.1:${actualPort}`;

  let closed = false;
  return {
    app,
    http: app.server,
    hub,
    loop,
    repo,
    url,
    wsUrl: `ws://127.0.0.1:${actualPort}`,
    rehydrate,
    livePetIds: () => [...live.keys()],
    async close() {
      if (closed) return;
      closed = true;
      if (sweepTimer) clearInterval(sweepTimer);
      loop.stop();
      await hub.close();
      await app.close();
      // General teardown: drop every pet's beep-debounce entry too, not only the
      // ones that died. Otherwise the debounce map leaks one key per pet that
      // was alive at shutdown (Task-9 minor).
      for (const id of live.keys()) forgetPet(id);
      live.clear();
    },
  };
}

/**
 * Advance a pet by `ms` in capped slices. A long outage would otherwise be one
 * huge synchronous `emu_step_n` call; slicing keeps each tick bounded. Total
 * emulated time is preserved — slicing only changes how it is delivered.
 */
function stepInSlices(pet: PetEmulator, ms: number): void {
  const SLICE = 60_000;
  let remaining = ms;
  while (remaining > 0) {
    const slice = Math.min(SLICE, remaining);
    pet.step(slice);
    remaining -= slice;
  }
}

/**
 * Build the real `web-push`-backed sender. `web-push` is loaded lazily so the
 * module imports cleanly (and tests run) without the package installed; only a
 * production boot ever touches it.
 */
function buildWebPushSender(vapid: VapidConfig): PushSender {
  const require = createRequire(import.meta.url);
  const webpush = require("web-push") as Parameters<typeof webPushSender>[0];
  return webPushSender(webpush, vapid);
}

/** Read configuration from the environment and run the server. */
async function main(): Promise<void> {
  const env = process.env;
  const pgUrl = env.DATABASE_URL ?? env.POSTGRES_URL;
  const clientId = env.GOOGLE_CLIENT_ID;
  const vapid = {
    subject: env.VAPID_SUBJECT ?? "",
    publicKey: env.VAPID_PUBLIC_KEY ?? "",
    privateKey: env.VAPID_PRIVATE_KEY ?? "",
  };
  const port = env.PORT ? Number(env.PORT) : 8080;

  if (!pgUrl) throw new Error("DATABASE_URL is required");
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is required");
  if (!vapid.publicKey || !vapid.privateKey) throw new Error("VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are required");

  const pool = new Pool({ connectionString: pgUrl });
  const publicDir = resolvePublicDir(env);

  // ROMs are copyrighted Bandai firmware and are NOT in the repo (see
  // emu/README.md). On a clean clone they are missing, so fail fast with a
  // message that names the exact missing file and how to provision it — instead
  // of a bare ENOENT from deep inside readFileSync at first pet hydration.
  const romPath = (device: string): string =>
    resolve(publicDir, `emu/rom${device === "p2" ? "2" : "0"}.bin`);
  const wasmPath = resolve(publicDir, "emu/tamalib.wasm");
  for (const p of [romPath("p1"), romPath("p2"), wasmPath]) {
    if (!existsSync(p)) {
      throw new Error(
        `missing emulator asset: ${p}\n` +
          "The Tamagotchi ROMs are copyrighted firmware and are not committed " +
          "(see emu/README.md). Provision rom0.bin (P1), rom2.bin (P2) and " +
          "tamalib.wasm under public/emu/ before starting the server.",
      );
    }
  }

  const srv = await startServer({
    pool,
    clientId,
    vapid,
    port,
    loadRom: (device) => new Uint8Array(readFileSync(romPath(device))),
    loadWasm: () => new Uint8Array(readFileSync(wasmPath)),
  });
  console.log(`[server] listening on ${srv.url} (ws ${srv.wsUrl}/ws)`);

  process.on("SIGTERM", () => void srv.close().then(() => process.exit(0)));
  process.on("SIGINT", () => void srv.close().then(() => process.exit(0)));
}

// Only auto-start when run as a script, not when imported by tests.
const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error("[server] fatal:", err);
    process.exit(1);
  });
}
