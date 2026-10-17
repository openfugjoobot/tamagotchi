import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { newDb, DataType } from "pg-mem";
import { randomUUID } from "node:crypto";
import type { Queryable, PushSub } from "../server/src/db/repo";
import { Repo } from "../server/src/db/repo";

/**
 * The repo talks to a `pg.Pool`-shaped object (`query(text, params)`), so the
 * same code runs against a real Postgres in production and against pg-mem in
 * tests. pg-mem implements very little natively, so the harness registers what
 * the schema and repo rely on:
 *
 *   * `gen_random_uuid()` — every `id` default.
 *   * `decode` / `encode` — the repo moves `bytea` as a hex string
 *     (`decode($n,'hex')` on write, `encode(col,'hex')` on read). pg-mem
 *     stringifies a raw Buffer parameter as UTF-8 before embedding it as a
 *     literal, which corrupts any byte >= 0x80 — fatal for a WASM snapshot.
 *     `decode`/`encode` are *native* Postgres functions, so the repo keeps
 *     byte-exact values on a real server too.
 */
function newTestPool(): Queryable {
  const db = newDb();
  db.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  db.public.registerFunction({
    name: "decode",
    args: [DataType.text, DataType.text],
    returns: DataType.bytea,
    implementation: (s: string, fmt: string) => Buffer.from(s, fmt as BufferEncoding),
  });
  db.public.registerFunction({
    name: "encode",
    args: [DataType.bytea, DataType.text],
    returns: DataType.text,
    implementation: (b: Buffer, fmt: string) => Buffer.from(b).toString(fmt as BufferEncoding),
  });
  db.public.none(readFileSync(resolve("server/src/db/schema.sql"), "utf8"));
  const PgPool = db.adapters.createPg().Pool;
  return new PgPool() as unknown as Queryable;
}

const PROFILE = {
  sub: "google-sub-123",
  email: "ivan@example.com",
  name: "Ivan",
  picture: "https://x/p.png",
};

describe("Repo", () => {
  let repo: Repo;

  beforeEach(() => {
    repo = new Repo(newTestPool());
  });

  it("upserts a user by google_sub: first insert, then update in place", async () => {
    const first = await repo.upsertUser(PROFILE);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.google_sub).toBe(PROFILE.sub);
    expect(first.email).toBe(PROFILE.email);

    // Same sub → same row, fields refreshed (no duplicate).
    const again = await repo.upsertUser({ ...PROFILE, name: "Ivan K." });
    expect(again.id).toBe(first.id);
    expect(again.name).toBe("Ivan K.");
  });

  it("creates a pet and round-trips its state byte-for-byte", async () => {
    const { id: userId } = await repo.upsertUser(PROFILE);
    const pet = await repo.createPet(userId, "p1");
    expect(pet.device).toBe("p1");
    expect(pet.alive).toBe(true);
    expect(pet.age_years).toBe(0);

    const state = new Uint8Array(512);
    for (let i = 0; i < state.length; i++) state[i] = (i * 7 + 200) % 256; // includes bytes >= 0x80
    await repo.savePetState(pet.id, state, true, null);

    const [loaded] = await repo.listPets(userId);
    expect(loaded.id).toBe(pet.id);
    expect(new Uint8Array(loaded.state!)).toEqual(state);

    // Death flip persists.
    await repo.savePetState(pet.id, state, false, new Date("2026-10-17T10:00:00Z"));
    const [dead] = await repo.listPets(userId);
    expect(dead.alive).toBe(false);
    expect(new Date(dead.died_at!).toISOString()).toBe("2026-10-17T10:00:00.000Z");
  });

  it("keeps a WASM-sized snapshot byte-exact, including every byte value", async () => {
    // Guards the hex/decode design against pg-mem's lossy Buffer parameter:
    // a snapshot is the raw WASM memory, so bytes >= 0x80 must survive intact.
    const { id: userId } = await repo.upsertUser(PROFILE);
    const pet = await repo.createPet(userId, "p1");
    const state = new Uint8Array(256 * 0x100);
    for (let i = 0; i < state.length; i++) state[i] = i & 0xff;
    await repo.savePetState(pet.id, state, true, null);

    const [loaded] = await repo.listPets(userId);
    expect(new Uint8Array(loaded.state!).length).toBe(state.length);
    expect(new Uint8Array(loaded.state!)).toEqual(state);
  });

  it("lists only the pets of the requested user", async () => {
    const a = await repo.upsertUser({ sub: "a" });
    const b = await repo.upsertUser({ sub: "b" });
    await repo.createPet(a.id, "p1");
    await repo.createPet(b.id, "p2");
    const pets = await repo.listPets(a.id);
    expect(pets.length).toBe(1);
    expect(pets[0].device).toBe("p1");
  });

  it("adds push subscriptions idempotently and removes them by endpoint", async () => {
    const { id: userId } = await repo.upsertUser(PROFILE);
    const sub: PushSub = { endpoint: "https://push/1", p256dh: "k1", auth: "a1", ua: "vitest" };
    await repo.addPushSub(userId, sub);

    let subs = await repo.listPushSubs(userId);
    expect(subs.length).toBe(1);
    expect(subs[0].endpoint).toBe(sub.endpoint);
    expect(subs[0].p256dh).toBe("k1");

    // Re-adding the same endpoint must not duplicate (unique endpoint).
    await repo.addPushSub(userId, sub);
    subs = await repo.listPushSubs(userId);
    expect(subs.length).toBe(1);

    await repo.removePushSub(sub.endpoint);
    subs = await repo.listPushSubs(userId);
    expect(subs.length).toBe(0);
    // Removing an unknown endpoint is a no-op, not an error.
    await expect(repo.removePushSub("https://push/none")).resolves.toBeUndefined();
  });

  it("records a beep as pending, then marks it notified", async () => {
    const { id: userId } = await repo.upsertUser(PROFILE);
    const pet = await repo.createPet(userId, "p1");
    await repo.recordBeep(pet.id);

    let pending = await repo.pendingBeeps();
    expect(pending.length).toBe(1);
    expect(pending[0].pet_id).toBe(pet.id);
    expect(pending[0].notified_at).toBeNull();

    await repo.markBeepNotified(pending[0].id);
    pending = await repo.pendingBeeps();
    expect(pending.length).toBe(0);
  });
});
