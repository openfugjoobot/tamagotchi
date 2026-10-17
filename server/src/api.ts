/**
 * Bearer-authenticated REST API (Fastify plugin).
 *
 * Every route is scoped to the authenticated user: the `Authorization: Bearer
 * <google-id-token>` header is verified (Google JWKS, the same code path as the
 * WebSocket hub) and its `sub` is resolved to a `users.id`. No route ever trusts
 * a client-supplied user id, and every repo call is keyed by that user id — a
 * foreign pet or slot resolves to `404`, never to someone else's data.
 *
 * Response discipline (spec §7):
 *   * missing/invalid token → `401`, with a body that names no cause, stack or
 *     verifier reason (no existence oracle).
 *   * a resource the caller does not own is indistinguishable from one that does
 *     not exist → `404`.
 *   * nothing that leaves this module carries a beep/death *cause* — the ROM
 *     exposes none (spec §3/§4), so fields like `kind`/`cause` never appear.
 *
 * Dependencies are injected (`repo`, `verify`, `startPet`) so the API runs in
 * tests against a fake repo and a fake verifier, with no Postgres, Google or
 * WASM. `startPet` is what makes `POST /api/pets` "start a fresh emulator": the
 * API creates the row, the injected callback brings up its live instance (the
 * entrypoint in Task 9 wires the real one).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyIdToken, type TokenClaims } from "./auth.js";
import type { BeepRow, Device, PetRow } from "./db/repo.js";

/** The repo surface the API consumes. Satisfied structurally by `Repo`. */
export interface ApiRepo {
  upsertUser(p: {
    sub: string;
    email?: string | null;
    name?: string | null;
    picture?: string | null;
  }): Promise<{ id: string }>;
  listPets(userId: string): Promise<PetRow[]>;
  getPet(userId: string, petId: string): Promise<PetRow | null>;
  createPet(userId: string, device: Device): Promise<PetRow>;
  createSlot(
    userId: string,
    slot: { label: string; snapshot: Uint8Array; device: string; ageYears: number },
  ): Promise<{ id: string; label: string; device: string; age_years: number; created_at: Date }>;
  listSlots(userId: string): Promise<Array<{ id: string; label: string; device: string; age_years: number; created_at: Date }>>;
  getSlot(userId: string, slotId: string): Promise<unknown>;
  deleteSlot(userId: string, slotId: string): Promise<void>;
  getSettings(userId: string): Promise<Record<string, unknown>>;
  setSettings(userId: string, settings: Record<string, unknown>): Promise<unknown>;
  addPushSub(
    userId: string,
    sub: { endpoint: string; p256dh: string; auth: string; ua?: string | null },
  ): Promise<unknown>;
  removePushSub(userId: string, endpoint: string): Promise<void>;
  listBeeps(userId: string, limit?: number): Promise<BeepRow[]>;
}

export interface ApiDeps {
  repo: ApiRepo;
  /** Verify a Google ID token. Defaults to the real JWKS verifier. */
  verify?: (token: string, clientId: string) => Promise<TokenClaims>;
  /** Google client id used as the token audience. */
  clientId: string;
  /** Bring up (or restart) the live emulator for a freshly created pet. */
  startPet?: (userId: string, petId: string) => Promise<void> | void;
  /**
   * Restore a save slot's snapshot into the live emulator for `petId`. The API
   * owns auth + ownership + device validation; the entrypoint owns the running
   * `PetEmulator` and the DB write, so the restore is injected here. The slot is
   * already proven to belong to `userId` and to match the pet's device.
   */
  loadSlot?: (
    userId: string,
    petId: string,
    slot: { id: string; snapshot: Uint8Array; device: string; ageYears: number },
  ) => Promise<void> | void;
}

/** Settings a user may change, with their allowed values (spec §3/§5).
 *
 * The id lists MUST mirror the real UI ids (`src/theme.ts` THEME_IDS,
 * `src/shell.ts` SHELLS): `applyServerSettings()` in the web client only applies
 * a server value that is an actual UI id, so an allow-list of `light`/`green`/
 * `dino` accepted exactly the values the UI then discarded — theme and shell
 * could never round-trip (Task-11 D2). `tests/server-api.test.ts` pins these to
 * the UI lists; change one, change both. */
const SETTINGS_DEFAULTS = { theme: "auto", lang: "de", shell: "teal", sound: true, push: true } as const;
const THEMES = ["blossom", "day", "dusk", "night", "midnight", "auto"] as const;
const LANGS = ["de", "en", "it"] as const;
const SHELLS = [
  "teal", "pink", "blue", "purple", "sunset", "mono", "mint", "coral", "pearl",
  "raptor", "amber", "swamp", "gecko",
] as const;

/** How many recent beeps `GET /api/beeps` returns. */
const BEEP_LIMIT = 50;

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (typeof h !== "string" || !h.startsWith("Bearer ")) return null;
  const token = h.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function iso(d: Date | string | null): string | null {
  return d === null ? null : new Date(d).toISOString();
}

/** The pet shape the API exposes — camelCase, and no cause of death. */
function petDto(p: PetRow) {
  return {
    id: p.id,
    device: p.device,
    name: p.name,
    alive: p.alive,
    ageYears: p.age_years,
    bornAt: iso(p.born_at),
    diedAt: iso(p.died_at),
  };
}

function slotDto(s: { id: string; label: string; device: string; age_years: number; created_at: Date }) {
  return { id: s.id, label: s.label, device: s.device, ageYears: s.age_years, createdAt: iso(s.created_at) };
}

function beepDto(b: BeepRow) {
  // No `kind`: the reason is never known (spec §3).
  return { id: b.id, petId: b.pet_id, at: iso(b.at), notified: b.notified_at !== null };
}

/** Merge stored settings over the defaults, keeping only known keys. */
function withDefaults(stored: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...SETTINGS_DEFAULTS };
  for (const key of Object.keys(SETTINGS_DEFAULTS) as Array<keyof typeof SETTINGS_DEFAULTS>) {
    if (key in stored) out[key] = stored[key];
  }
  return out;
}

/** Validate a partial settings patch. Returns an error message or null. */
function validateSettings(patch: Record<string, unknown>): string | null {
  if ("theme" in patch && !THEMES.includes(patch.theme as (typeof THEMES)[number])) return "bad theme";
  if ("lang" in patch && !LANGS.includes(patch.lang as (typeof LANGS)[number])) return "bad lang";
  if ("shell" in patch && !SHELLS.includes(patch.shell as (typeof SHELLS)[number])) return "bad shell";
  if ("sound" in patch && typeof patch.sound !== "boolean") return "bad sound";
  if ("push" in patch && typeof patch.push !== "boolean") return "bad push";
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The slot shape the load route consumes (repo `getSlot` is typed `unknown`). */
interface LoadableSlot {
  id: string;
  snapshot: Uint8Array;
  device: string;
  age_years: number;
}

/**
 * Narrow a `repo.getSlot` result to what the load route needs. The repo is typed
 * `unknown` on `ApiRepo` so the API does not depend on the concrete `SlotRow`;
 * this validates the fields it actually reads and returns `null` for anything
 * that is not a real slot row (never trusts the shape blindly).
 */
function asSlot(v: unknown): LoadableSlot | null {
  if (!isRecord(v)) return null;
  const snapshot = v.snapshot;
  if (typeof v.id !== "string" || typeof v.device !== "string") return null;
  if (typeof v.age_years !== "number") return null;
  if (!(snapshot instanceof Uint8Array)) return null;
  return { id: v.id, snapshot, device: v.device, age_years: v.age_years };
}

/**
 * Register the REST API on a Fastify instance.
 *
 * Auth runs in an `onRequest` hook for every `/api/*` route, so no route body
 * can execute before the caller is identified; the resolved user id is stashed
 * on the request and read back with `userId(req)`.
 */
export function registerApi(app: FastifyInstance, deps: ApiDeps): void {
  const verify = deps.verify ?? verifyIdToken;
  const repo = deps.repo;

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith("/api/")) return;
    const token = bearer(req);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    let claims: TokenClaims;
    try {
      claims = await verify(token, deps.clientId);
    } catch {
      // No cause, no stack: a bad token tells the caller nothing.
      return reply.code(401).send({ error: "unauthorized" });
    }
    const user = await repo.upsertUser({
      sub: claims.sub,
      email: claims.email ?? null,
      name: claims.name ?? null,
      picture: claims.picture ?? null,
    });
    (req as AuthedRequest).userId = user.id;
  });

  // ---- pets ---------------------------------------------------------------

  app.get("/api/pets", async (req) => {
    const pets = await repo.listPets(userId(req));
    return pets.map(petDto);
  });

  app.post("/api/pets", async (req, reply) => {
    const body = req.body;
    const device = isRecord(body) ? body.device : undefined;
    if (device !== "p1" && device !== "p2") {
      return reply.code(400).send({ error: "bad device" });
    }
    const uid = userId(req);
    const pet = await repo.createPet(uid, device as Device);
    // The row exists; the injected hook brings its live emulator up.
    await deps.startPet?.(uid, pet.id);
    return reply.code(201).send(petDto(pet));
  });

  // ---- save slots ---------------------------------------------------------

  app.get("/api/pets/:id/slots", async (req, reply) => {
    const { id } = req.params as { id: string };
    const pet = await repo.getPet(userId(req), id);
    if (!pet) return reply.code(404).send({ error: "not found" });
    const slots = await repo.listSlots(userId(req));
    // Slots belong to the user; under a pet we show the ones for its device.
    return slots.filter((s) => s.device === pet.device).map(slotDto);
  });

  app.post("/api/pets/:id/slots", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body;
    const label = isRecord(body) ? body.label : undefined;
    if (typeof label !== "string" || label.trim().length === 0) {
      return reply.code(400).send({ error: "bad label" });
    }
    const uid = userId(req);
    const pet = await repo.getPet(uid, id);
    if (!pet) return reply.code(404).send({ error: "not found" });
    // A slot snapshots the pet's *current* saved state (may be unset before the
    // first persist — then the slot is a fresh, empty snapshot).
    const snapshot = pet.state ? new Uint8Array(pet.state) : new Uint8Array(0);
    const slot = await repo.createSlot(uid, {
      label: label.trim(),
      snapshot,
      device: pet.device,
      ageYears: pet.age_years,
    });
    return reply.code(201).send(slotDto(slot));
  });

  app.delete("/api/slots/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const slot = await repo.getSlot(userId(req), id);
    if (!slot) return reply.code(404).send({ error: "not found" });
    await repo.deleteSlot(userId(req), id);
    return reply.code(204).send();
  });

  /**
   * Load a save slot into one of the caller's pets. Owner-scoped twice over:
   * the pet must be the caller's (`getPet`), the slot must be the caller's
   * (`getSlot`), and both `404` when they are not — a foreign id is
   * indistinguishable from a missing one. A slot belongs to a *device*, so it
   * only loads into a pet of the same device; otherwise `409`.
   */
  app.post("/api/pets/:id/slots/:slotId/load", async (req, reply) => {
    const { id, slotId } = req.params as { id: string; slotId: string };
    const uid = userId(req);
    const pet = await repo.getPet(uid, id);
    if (!pet) return reply.code(404).send({ error: "not found" });
    const slot = asSlot(await repo.getSlot(uid, slotId));
    if (!slot) return reply.code(404).send({ error: "not found" });
    if (slot.device !== pet.device) return reply.code(409).send({ error: "device mismatch" });
    // Auth + ownership + device are settled; the entrypoint restores the bytes
    // into the live emulator and persists the new state.
    await deps.loadSlot?.(uid, id, {
      id: slot.id,
      snapshot: slot.snapshot,
      device: slot.device,
      ageYears: slot.age_years,
    });
    return { ok: true, petId: id, slotId: slot.id };
  });

  // ---- settings -----------------------------------------------------------

  app.get("/api/settings", async (req) => {
    const stored = await repo.getSettings(userId(req));
    return withDefaults(stored);
  });

  app.put("/api/settings", async (req, reply) => {
    const patch = req.body;
    if (!isRecord(patch)) return reply.code(400).send({ error: "bad body" });
    const invalid = validateSettings(patch);
    if (invalid) return reply.code(400).send({ error: invalid });
    const uid = userId(req);
    const merged = { ...withDefaults(await repo.getSettings(uid)), ...patch };
    await repo.setSettings(uid, merged);
    return merged;
  });

  // ---- push subscriptions -------------------------------------------------

  app.post("/api/push/subscribe", async (req, reply) => {
    const body = req.body;
    const b = isRecord(body) ? body : {};
    const { endpoint, p256dh, auth } = b;
    if (typeof endpoint !== "string" || endpoint.length === 0) {
      return reply.code(400).send({ error: "bad endpoint" });
    }
    if (typeof p256dh !== "string" || typeof auth !== "string") {
      return reply.code(400).send({ error: "bad keys" });
    }
    await repo.addPushSub(userId(req), {
      endpoint,
      p256dh,
      auth,
      ua: typeof b.ua === "string" ? b.ua : null,
    });
    return reply.code(201).send({ ok: true });
  });

  app.post("/api/push/unsubscribe", async (req, reply) => {
    const body = req.body;
    const endpoint = isRecord(body) ? body.endpoint : undefined;
    if (typeof endpoint !== "string" || endpoint.length === 0) {
      return reply.code(400).send({ error: "bad endpoint" });
    }
    // Scoped to the caller: a foreign endpoint matches nothing and cannot be
    // deleted by someone who merely knows the string (Task-8 review).
    await repo.removePushSub(userId(req), endpoint);
    return reply.code(204).send();
  });

  // ---- beeps --------------------------------------------------------------

  app.get("/api/beeps", async (req) => {
    const beeps = await repo.listBeeps(userId(req), BEEP_LIMIT);
    return beeps.map(beepDto);
  });
}

/** Request with the resolved user id attached by the auth hook. */
interface AuthedRequest extends FastifyRequest {
  userId?: string;
}

function userId(req: FastifyRequest): string {
  const id = (req as AuthedRequest).userId;
  if (!id) throw new Error("unauthenticated request reached a handler");
  return id;
}

/** Exposed for tests: the settings a fresh user starts with. */
export const SETTINGS_BASE = SETTINGS_DEFAULTS;
