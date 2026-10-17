import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerApi, type ApiRepo } from "../server/src/api";
import type { TokenClaims } from "../server/src/auth";
import type { BeepRow, PetRow, PushSub, PushSubRow, UserRow } from "../server/src/db/repo";

/**
 * The HTTP API is exercised against a *fake* repo and a *fake* verifier, so the
 * whole surface runs without Postgres, Google, WASM or network. The fake mirrors
 * the `Repo` shapes the routes consume; the real `Repo` is wired structurally by
 * the type on `ApiRepo` and, for save slots, proven against pg-mem in
 * `tests/server-repo.test.ts`.
 */

const CLIENT = "1234.apps.googleusercontent.com";
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

/** Tokens accepted by the fake verifier; anything else is rejected. */
const GOOD = "good-token";
const GOOD2 = "good-token-2";
const SUB = "google-sub-1";
const SUB2 = "google-sub-2";

/** Minimal in-memory stand-in for `Repo`, keyed by the fields routes touch. */
class FakeRepo implements ApiRepo {
  users = new Map<string, UserRow>();
  pets: PetRow[] = [];
  slots: Array<{
    id: string;
    user_id: string;
    label: string;
    snapshot: Buffer;
    device: string;
    age_years: number;
    created_at: Date;
  }> = [];
  pushSubs: PushSubRow[] = [];
  beeps: BeepRow[] = [];
  private seq = 0;

  private id(prefix: string): string {
    return `${prefix}-${++this.seq}`;
  }

  async upsertUser(p: { sub: string; email?: string | null; name?: string | null; picture?: string | null }): Promise<UserRow> {
    for (const u of this.users.values()) {
      if (u.google_sub === p.sub) {
        u.email = p.email ?? null;
        u.name = p.name ?? null;
        u.picture = p.picture ?? null;
        return u;
      }
    }
    const row: UserRow = {
      id: this.id("user"),
      google_sub: p.sub,
      email: p.email ?? null,
      name: p.name ?? null,
      picture: p.picture ?? null,
      settings: {},
      created_at: new Date(NOW),
      last_seen_at: new Date(NOW),
    };
    this.users.set(row.id, row);
    return row;
  }

  async listPets(userId: string): Promise<PetRow[]> {
    return this.pets.filter((p) => p.user_id === userId);
  }

  async getPet(userId: string, petId: string): Promise<PetRow | null> {
    return this.pets.find((p) => p.id === petId && p.user_id === userId) ?? null;
  }

  async createPet(userId: string, device: "p1" | "p2"): Promise<PetRow> {
    const row: PetRow = {
      id: this.id("pet"),
      user_id: userId,
      device,
      rom_ver: "1",
      name: null,
      state: null,
      state_ver: 1,
      born_at: new Date(NOW),
      age_years: 0,
      alive: true,
      died_at: null,
      last_tick_at: new Date(NOW),
      updated_at: new Date(NOW),
    };
    this.pets.push(row);
    return row;
  }

  async createSlot(
    userId: string,
    slot: { label: string; snapshot: Uint8Array; device: string; ageYears: number },
  ): Promise<{ id: string; user_id: string; label: string; snapshot: Buffer; device: string; age_years: number; created_at: Date }> {
    const row = {
      id: this.id("slot"),
      user_id: userId,
      label: slot.label,
      snapshot: Buffer.from(slot.snapshot),
      device: slot.device,
      age_years: slot.ageYears,
      created_at: new Date(NOW),
    };
    this.slots.push(row);
    return row;
  }

  async listSlots(userId: string): Promise<Array<{ id: string; label: string; device: string; age_years: number; created_at: Date }>> {
    return this.slots
      .filter((s) => s.user_id === userId)
      .map((s) => ({ id: s.id, label: s.label, device: s.device, age_years: s.age_years, created_at: s.created_at }));
  }

  async getSlot(userId: string, slotId: string) {
    return this.slots.find((s) => s.id === slotId && s.user_id === userId) ?? null;
  }

  async deleteSlot(userId: string, slotId: string): Promise<void> {
    this.slots = this.slots.filter((s) => !(s.id === slotId && s.user_id === userId));
  }

  async getSettings(userId: string): Promise<Record<string, unknown>> {
    return this.users.get(userId)?.settings ?? {};
  }

  async setSettings(userId: string, settings: Record<string, unknown>): Promise<Record<string, unknown>> {
    const u = this.users.get(userId);
    if (!u) return {};
    u.settings = settings;
    return settings;
  }

  async addPushSub(userId: string, sub: PushSub): Promise<PushSubRow> {
    // Per-user key: only the caller's own row for this endpoint is refreshed —
    // a foreign row with the same endpoint is never reassigned (Task-8 fix).
    const existing = this.pushSubs.find((s) => s.endpoint === sub.endpoint && s.user_id === userId);
    if (existing) {
      existing.p256dh = sub.p256dh;
      existing.auth = sub.auth;
      existing.ua = sub.ua ?? null;
      return existing;
    }
    const row: PushSubRow = {
      id: this.id("sub"),
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      ua: sub.ua ?? null,
      created_at: new Date(NOW),
      last_ok_at: null,
      failed_at: null,
    };
    this.pushSubs.push(row);
    return row;
  }

  async removePushSub(userId: string, endpoint: string): Promise<void> {
    this.pushSubs = this.pushSubs.filter((s) => !(s.endpoint === endpoint && s.user_id === userId));
  }

  async listBeeps(userId: string, limit: number): Promise<BeepRow[]> {
    const petIds = new Set(this.pets.filter((p) => p.user_id === userId).map((p) => p.id));
    return this.beeps.filter((b) => petIds.has(b.pet_id)).slice(0, limit);
  }
}

/** Verify only the two known tokens; produce the same claims shape as Google's. */
async function verify(token: string): Promise<TokenClaims> {
  const sub = token === GOOD ? SUB : token === GOOD2 ? SUB2 : null;
  if (sub === null) throw new Error("bad token");
  return {
    sub,
    aud: CLIENT,
    iss: "https://accounts.google.com",
    exp: Math.floor(NOW / 1000) + 3600,
    email: "ivan@example.com",
    name: "Ivan",
  };
}

function build(repo: FakeRepo, started: string[] = []): FastifyInstance {
  const app = Fastify();
  registerApi(app, {
    repo,
    verify,
    clientId: CLIENT,
    startPet: (_userId, petId) => {
      started.push(petId);
    },
  });
  return app;
}

/** The response type `app.inject()` resolves to (Fastify's inject result). */
type InjectResponse = Awaited<ReturnType<FastifyInstance["inject"]>>;

/** A request authenticated with a bearer token (default: the first user's). */
function authed(
  app: FastifyInstance,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: object,
  token: string = GOOD,
): Promise<InjectResponse> {
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });
}

describe("HTTP API", () => {
  let repo: FakeRepo;
  let app: FastifyInstance;
  let started: string[];

  beforeEach(() => {
    repo = new FakeRepo();
    started = [];
    app = build(repo, started);
  });

  describe("auth", () => {
    it("rejects a missing token with 401", async () => {
      const res = await app.inject({ method: "GET", url: "/api/pets" });
      expect(res.statusCode).toBe(401);
    });

    it("rejects an invalid token with 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/pets",
        headers: { authorization: "Bearer nope" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("accepts a valid token and creates the user on first sight", async () => {
      const res = await authed(app, "GET", "/api/pets");
      expect(res.statusCode).toBe(200);
      expect(repo.users.size).toBe(1);
    });

    it("does not leak an error cause in the 401 body", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/pets",
        headers: { authorization: "Bearer nope" },
      });
      expect(JSON.stringify(res.json())).not.toMatch(/cause|stack|bad token/i);
    });
  });

  describe("pets", () => {
    it("lists the user's pets with the documented shape and no cause field", async () => {
      const me = await repo.upsertUser({ sub: SUB });
      repo.pets.push({
        id: "pet-1", user_id: me.id, device: "p1", rom_ver: "1", name: "Rex",
        state: null, state_ver: 1, born_at: new Date("2026-01-01T00:00:00Z"),
        age_years: 3, alive: false, died_at: new Date("2026-02-01T00:00:00Z"),
        last_tick_at: new Date(), updated_at: new Date(),
      });

      const res = await authed(app, "GET", "/api/pets");
      expect(res.statusCode).toBe(200);
      const [pet] = res.json();
      expect(pet).toEqual({
        id: "pet-1", device: "p1", name: "Rex", alive: false,
        ageYears: 3, bornAt: "2026-01-01T00:00:00.000Z", diedAt: "2026-02-01T00:00:00.000Z",
      });
      expect(JSON.stringify(pet)).not.toMatch(/cause/i);
    });

    it("creates a pet on the given device and starts its emulator", async () => {
      const res = await authed(app, "POST", "/api/pets", { device: "p2" });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toMatchObject({ device: "p2", alive: true, ageYears: 0 });
      expect(typeof body.id).toBe("string");
      expect(started).toEqual([body.id]);
      // The pet is the caller's, not anyone else's.
      const me = [...repo.users.values()][0];
      expect(repo.pets[0].user_id).toBe(me.id);
    });

    it("rejects an unknown device with 400", async () => {
      const res = await authed(app, "POST", "/api/pets", { device: "p3" });
      expect(res.statusCode).toBe(400);
    });

    it("rejects a missing device with 400", async () => {
      const res = await authed(app, "POST", "/api/pets", {});
      expect(res.statusCode).toBe(400);
    });
  });

  describe("save slots", () => {
    async function petFor(sub: string, device: "p1" | "p2" = "p1"): Promise<{ userId: string; petId: string }> {
      const me = await repo.upsertUser({ sub });
      const pet = await repo.createPet(me.id, device);
      // A real pet carries a snapshot; slots snapshot exactly this.
      pet.state = Buffer.from([1, 2, 3, 4]);
      pet.age_years = 5;
      return { userId: me.id, petId: pet.id };
    }

    it("creates and lists slots for a pet owned by the caller", async () => {
      const { petId } = await petFor(SUB);

      const created = await authed(app, "POST", `/api/pets/${petId}/slots`, { label: "before boss" });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ label: "before boss", device: "p1", ageYears: 5 });

      const listed = await authed(app, "GET", `/api/pets/${petId}/slots`);
      expect(listed.statusCode).toBe(200);
      const rows = listed.json();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ label: "before boss", device: "p1", ageYears: 5 });
      // A slot list never carries the snapshot bytes.
      expect(JSON.stringify(rows[0])).not.toMatch(/snapshot/);
    });

    it("404s on a pet that belongs to another user (no cross-user access)", async () => {
      const { petId } = await petFor("other-sub");
      const res = await authed(app, "POST", `/api/pets/${petId}/slots`, { label: "mine" });
      expect(res.statusCode).toBe(404);
    });

    it("404s on an unknown pet", async () => {
      const res = await authed(app, "POST", "/api/pets/nope/slots", { label: "x" });
      expect(res.statusCode).toBe(404);
    });

    it("rejects an empty label with 400", async () => {
      const { petId } = await petFor(SUB);
      const res = await authed(app, "POST", `/api/pets/${petId}/slots`, { label: "" });
      expect(res.statusCode).toBe(400);
    });

    it("deletes the caller's own slot", async () => {
      const { petId } = await petFor(SUB);
      const created = await authed(app, "POST", `/api/pets/${petId}/slots`, { label: "s" });
      const slotId = created.json().id;

      const del = await authed(app, "DELETE", `/api/slots/${slotId}`);
      expect([200, 204]).toContain(del.statusCode);

      const listed = await authed(app, "GET", `/api/pets/${petId}/slots`);
      expect(listed.json()).toHaveLength(0);
    });

    it("cannot delete another user's slot", async () => {
      // User 1 creates a slot on their own pet.
      const { petId } = await petFor(SUB);
      const created = await authed(app, "POST", `/api/pets/${petId}/slots`, { label: "mine" });
      const slotId = created.json().id;

      // User 2's token must not see or delete it — 404, and the row survives.
      const del = await authed(app, "DELETE", `/api/slots/${slotId}`, undefined, GOOD2);
      expect(del.statusCode).toBe(404);
      expect(repo.slots).toHaveLength(1);
    });
  });

  describe("settings", () => {
    it("returns defaults for a fresh user", async () => {
      const res = await authed(app, "GET", "/api/settings");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ theme: "light", lang: "de", shell: "green", sound: true, push: true });
    });

    it("merges a partial update and persists it", async () => {
      const put = await authed(app, "PUT", "/api/settings", { theme: "dark", push: false });
      expect(put.statusCode).toBe(200);
      expect(put.json()).toMatchObject({ theme: "dark", push: false, lang: "de", shell: "green", sound: true });

      const get = await authed(app, "GET", "/api/settings");
      expect(get.json()).toMatchObject({ theme: "dark", push: false });
    });

    it("rejects unknown settings values with 400", async () => {
      const res = await authed(app, "PUT", "/api/settings", { theme: "neon" });
      expect(res.statusCode).toBe(400);
    });

    it("rejects an unknown lang with 400", async () => {
      const res = await authed(app, "PUT", "/api/settings", { lang: "fr" });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("push subscriptions", () => {
    it("subscribes and unsubscribes by endpoint", async () => {
      const sub = { endpoint: "https://push/1", p256dh: "k", auth: "a", ua: "vitest" };
      const ok = await authed(app, "POST", "/api/push/subscribe", sub);
      expect([200, 201]).toContain(ok.statusCode);
      expect(repo.pushSubs).toHaveLength(1);
      expect(repo.pushSubs[0].endpoint).toBe(sub.endpoint);

      const off = await authed(app, "POST", "/api/push/unsubscribe", { endpoint: sub.endpoint });
      expect([200, 204]).toContain(off.statusCode);
      expect(repo.pushSubs).toHaveLength(0);
    });

    it("rejects a subscription missing p256dh with 400", async () => {
      const res = await authed(app, "POST", "/api/push/subscribe", { endpoint: "https://push/2", auth: "a" });
      expect(res.statusCode).toBe(400);
    });

    it("re-subscribing the same endpoint does not duplicate", async () => {
      const sub = { endpoint: "https://push/1", p256dh: "k", auth: "a" };
      await authed(app, "POST", "/api/push/subscribe", sub);
      await authed(app, "POST", "/api/push/subscribe", { ...sub, p256dh: "k2" });
      expect(repo.pushSubs).toHaveLength(1);
      expect(repo.pushSubs[0].p256dh).toBe("k2");
    });

    it("does not let a second user steal an endpoint via subscribe (Task-8 regression)", async () => {
      const sub = { endpoint: "https://push/shared", p256dh: "k", auth: "a" };
      // User 1 subscribes.
      await authed(app, "POST", "/api/push/subscribe", sub);
      const owner1 = repo.pushSubs[0].user_id;

      // User 2 presents the same endpoint string. It must create its own row, not
      // reassign user 1's — the old `on conflict (endpoint)` stole the row.
      await authed(app, "POST", "/api/push/subscribe", sub, GOOD2);
      expect(repo.pushSubs).toHaveLength(2);
      expect(repo.pushSubs.filter((s) => s.user_id === owner1)).toHaveLength(1);
      // Both are addressed by their own owners now.
      const owner2 = repo.pushSubs.find((s) => s.user_id !== owner1)!.user_id;
      expect(owner2).not.toBe(owner1);
    });

    it("cannot unsubscribe another user's endpoint (Task-8 regression)", async () => {
      const sub = { endpoint: "https://push/mine", p256dh: "k", auth: "a" };
      await authed(app, "POST", "/api/push/subscribe", sub); // user 1
      await authed(app, "POST", "/api/push/unsubscribe", { endpoint: sub.endpoint }, GOOD2); // user 2
      // User 1's subscription survives a foreign unsubscribe.
      expect(repo.pushSubs).toHaveLength(1);
      expect(repo.pushSubs[0].endpoint).toBe(sub.endpoint);
    });
  });

  describe("beeps", () => {
    it("lists recent beeps for the caller's pets only, without a cause", async () => {
      const me = await repo.upsertUser({ sub: SUB });
      const mine = await repo.createPet(me.id, "p1");
      const other = await repo.upsertUser({ sub: "other-sub" });
      const theirs = await repo.createPet(other.id, "p2");
      repo.beeps.push(
        { id: "b1", pet_id: mine.id, at: new Date("2026-01-02T08:00:00Z"), notified_at: null },
        { id: "b2", pet_id: theirs.id, at: new Date("2026-01-02T09:00:00Z"), notified_at: null },
      );

      const res = await authed(app, "GET", "/api/beeps");
      expect(res.statusCode).toBe(200);
      const rows = res.json();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ id: "b1", petId: mine.id, at: "2026-01-02T08:00:00.000Z", notified: false });
      expect(JSON.stringify(rows[0])).not.toMatch(/kind|cause/i);
    });
  });
});
