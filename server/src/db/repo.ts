/**
 * Thin repository layer over Postgres.
 *
 * `Repo` only needs a `pg.Pool`-shaped object — anything with
 * `query(text, params)` — so the same code runs against a real server in
 * production and against pg-mem in tests. No ORM, no query builder: each method
 * is one statement, which keeps the SQL reviewable and the mapping explicit.
 *
 * `bytea` is moved as a hex string (`decode($n,'hex')` on write,
 * `encode(col,'hex')` on read). That keeps arbitrary binary — e.g. a WASM
 * memory snapshot with bytes >= 0x80 — byte-exact on both engines; a raw Buffer
 * parameter would be mangled by pg-mem (see tests/server-repo.test.ts).
 */

/**
 * Minimal query surface shared by `pg.Pool`, `pg.PoolClient` and pg-mem.
 * Declared structurally so this module needs no `pg` dependency at build time;
 * a real `pg.Pool` and a `pg-mem` pool both satisfy it.
 */
export interface Queryable {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Profile {
  sub: string;
  email?: string | null;
  name?: string | null;
  picture?: string | null;
}

export interface UserRow {
  id: string;
  google_sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  settings: Record<string, unknown>;
  created_at: Date;
  last_seen_at: Date | null;
}

export type Device = "p1" | "p2";

export interface PetRow {
  id: string;
  user_id: string;
  device: Device;
  rom_ver: string;
  name: string | null;
  state: Buffer | null;
  state_ver: number;
  born_at: Date;
  age_years: number;
  alive: boolean;
  died_at: Date | null;
  last_tick_at: Date;
  updated_at: Date;
}

export interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
  ua?: string | null;
}

export interface PushSubRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  ua: string | null;
  created_at: Date;
  last_ok_at: Date | null;
  failed_at: Date | null;
}

/**
 * A push subscription as the sender needs it: only the columns a push uses,
 * `user_id` aliased to camelCase. Mirrors the `PushSubLike` interface the sweeper
 * consumes (`server/src/push.ts`) so `Repo` stays structurally assignable to
 * `PushRepo` — same trick as `PendingBeepRow`/`PendingBeep`.
 */
export interface PushSubLikeRow {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface BeepRow {
  id: string;
  pet_id: string;
  at: Date;
  notified_at: Date | null;
}

/**
 * A manual save slot (spec §3 `save_slots`). Slots belong to a **user**, not a
 * pet: they are addressed under a pet for create/list (the pet supplies the
 * `device`/`age_years` metadata and the snapshot), but they outlive that pet, so
 * the row carries `user_id` and no `pet_id`.
 */
export interface SlotRow {
  id: string;
  user_id: string;
  label: string;
  snapshot: Buffer;
  device: string;
  age_years: number;
  created_at: Date;
}

/** A slot as a list returns it — metadata only, never the snapshot bytes. */
export interface SlotMetaRow {
  id: string;
  label: string;
  device: string;
  age_years: number;
  created_at: Date;
}

/**
 * A pending beep joined to its owner. `pendingBeeps()` needs the owner because a
 * push goes to a *user*, while a beep row only names a pet. These names match
 * the `PendingBeep` interface the sweeper consumes (`server/src/push.ts`) — the
 * structural contract is pinned by the integration test in
 * `tests/server-push.test.ts`.
 */
export interface PendingBeepRow {
  id: string;
  petId: string;
  userId: string;
}

/** Firmware revision recorded on each pet (spec §3 `rom_ver`). */
const ROM_VER = "1";

function toHex(buf: Uint8Array): string {
  return Buffer.from(buf).toString("hex");
}

export class Repo {
  constructor(private readonly pool: Queryable) {}

  /**
   * Create the user on first sight, refresh identity fields afterwards.
   * Returns the full row so callers get the stable `id`.
   */
  async upsertUser(p: Profile): Promise<UserRow> {
    const { rows } = await this.pool.query<UserRow>(
      `insert into users (google_sub, email, name, picture, last_seen_at)
       values ($1, $2, $3, $4, now())
       on conflict (google_sub) do update
         set email = excluded.email,
             name = excluded.name,
             picture = excluded.picture,
             last_seen_at = now()
       returning *`,
      [p.sub, p.email ?? null, p.name ?? null, p.picture ?? null],
    );
    return rows[0];
  }

  /** All pets of a user, newest first — this list is the pet's history. */
  async listPets(userId: string): Promise<PetRow[]> {
    const { rows } = await this.pool.query<PetRow>(
      `select * from pets where user_id = $1 order by born_at desc`,
      [userId],
    );
    return rows;
  }

  /**
   * One pet, **scoped to its owner**. The `user_id` predicate is not optional:
   * a load that only matched `id` would bind a foreign pet. Returns null when the
   * pet does not exist *or* belongs to someone else, so callers cannot tell the
   * two apart (no existence oracle).
   */
  async getPet(userId: string, petId: string): Promise<PetRow | null> {
    const { rows } = await this.pool.query<PetRow>(
      `select * from pets where id = $1 and user_id = $2`,
      [petId, userId],
    );
    return rows[0] ?? null;
  }

  /** A new, living pet for the given device. */
  async createPet(userId: string, device: Device, romVer: string = ROM_VER): Promise<PetRow> {
    const { rows } = await this.pool.query<PetRow>(
      `insert into pets (user_id, device, rom_ver)
       values ($1, $2, $3)
       returning *`,
      [userId, device, romVer],
    );
    return rows[0];
  }

  /**
   * Persist the emulator snapshot and life-state for one tick. `diedAt` is the
   * only death information stored (spec §3 — no cause of death).
   */
  async savePetState(
    petId: string,
    state: Uint8Array,
    alive: boolean,
    diedAt: Date | null,
  ): Promise<void> {
    await this.pool.query(
      `update pets
         set state = decode($2, 'hex'),
             alive = $3,
             died_at = $4,
             last_tick_at = now(),
             updated_at = now()
       where id = $1`,
      [petId, toHex(state), alive, diedAt],
    );
  }

  /**
   * Push subscriptions of a user, aliased to the `PushSubLike` shape the push
   * sweeper consumes (`user_id` → `userId`). Returning the full row would leave
   * `Repo` structurally incompatible with `PushRepo` (missing `userId`).
   */
  async listPushSubs(userId: string): Promise<PushSubLikeRow[]> {
    const { rows } = await this.pool.query<PushSubLikeRow>(
      `select id, user_id as "userId", endpoint, p256dh, auth
         from push_subs
        where user_id = $1
        order by created_at desc`,
      [userId],
    );
    return rows;
  }

  /**
   * Register a push subscription, **scoped to its owner**. `endpoint` is unique,
   * so re-subscribing the same browser refreshes it in place instead of
   * duplicating.
   *
   * The conflict target is the compound `(user_id, endpoint)` key, so an insert
   * can only ever touch the caller's own row. Keying the conflict on `endpoint`
   * alone let any authenticated user *hijack* another user's subscription just
   * by presenting the same endpoint string — the row was reassigned with
   * `set user_id = excluded.user_id` (proven cross-user write, Task-8 review).
   * The migration replaces the global unique with a per-user unique so two users
   * can hold the same endpoint without colliding at all (see `schema.sql`).
   */
  async addPushSub(userId: string, sub: PushSub): Promise<PushSubRow> {
    const { rows } = await this.pool.query<PushSubRow>(
      `insert into push_subs (user_id, endpoint, p256dh, auth, ua)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id, endpoint) do update
         set p256dh = excluded.p256dh,
             auth = excluded.auth,
             ua = excluded.ua,
             failed_at = null
       returning *`,
      [userId, sub.endpoint, sub.p256dh, sub.auth, sub.ua ?? null],
    );
    return rows[0];
  }

  /**
   * Drop a subscription by endpoint (used on `410 Gone`), **scoped to its
   * owner**. A foreign endpoint matches nothing — it must never delete another
   * user's row (a bare `where endpoint = $1` was a proven cross-user delete).
   */
  async removePushSub(userId: string, endpoint: string): Promise<void> {
    await this.pool.query(`delete from push_subs where user_id = $1 and endpoint = $2`, [
      userId,
      endpoint,
    ]);
  }

  /** Record that a pet beeped. No cause is stored (spec §3 — no `kind`). */
  async recordBeep(petId: string): Promise<BeepRow> {
    const { rows } = await this.pool.query<BeepRow>(
      `insert into beeps (pet_id) values ($1) returning *`,
      [petId],
    );
    return rows[0];
  }

  /**
   * Beeps not yet pushed to the user, oldest first, **each joined to its owner**
   * (`beeps → pets → users`). `petId`/`userId` are aliased camelCase so this row
   * is directly the `PendingBeep` the push sweeper consumes.
   */
  async pendingBeeps(): Promise<PendingBeepRow[]> {
    const { rows } = await this.pool.query<PendingBeepRow>(
      `select b.id as id, b.pet_id as "petId", p.user_id as "userId"
         from beeps b
         join pets p on p.id = b.pet_id
        where b.notified_at is null
        order by b.at asc`,
    );
    return rows;
  }

  /** Mark a beep as delivered so it is not pushed again. */
  async markBeepNotified(id: string): Promise<void> {
    await this.pool.query(`update beeps set notified_at = now() where id = $1`, [id]);
  }

  /**
   * Recent beeps for a user's pets, newest first — the notification history. The
   * owner is enforced through the `pets` join (a beep only names a pet).
   */
  async listBeeps(userId: string, limit = 50): Promise<BeepRow[]> {
    const { rows } = await this.pool.query<BeepRow>(
      `select b.*
         from beeps b
         join pets p on p.id = b.pet_id
        where p.user_id = $1
        order by b.at desc
        limit $2`,
      [userId, limit],
    );
    return rows;
  }

  /** A user's settings object (empty object when never set). */
  async getSettings(userId: string): Promise<Record<string, unknown>> {
    const { rows } = await this.pool.query<{ settings: Record<string, unknown> | string }>(
      `select settings from users where id = $1`,
      [userId],
    );
    const raw = rows[0]?.settings;
    if (raw === undefined || raw === null) return {};
    // real `pg` parses `jsonb` into an object; pg-mem hands back the raw text.
    return typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : raw;
  }

  /** Replace a user's settings object with the given one. */
  async setSettings(userId: string, settings: Record<string, unknown>): Promise<void> {
    await this.pool.query(`update users set settings = $2::jsonb where id = $1`, [
      userId,
      JSON.stringify(settings),
    ]);
  }

  /**
   * Snapshot a pet into a labelled save slot. The snapshot is moved as hex
   * (`encode`/`decode`) like `pets.state`, so arbitrary WASM bytes survive.
   */
  async createSlot(
    userId: string,
    slot: { label: string; snapshot: Uint8Array; device: string; ageYears: number },
  ): Promise<SlotRow> {
    const { rows } = await this.pool.query<SlotRow>(
      `insert into save_slots (user_id, label, snapshot, device, age_years)
       values ($1, $2, decode($3, 'hex'), $4, $5)
       returning id, user_id, label, encode(snapshot, 'hex') as snapshot, device, age_years, created_at`,
      [userId, slot.label, toHex(slot.snapshot), slot.device, slot.ageYears],
    );
    const row = rows[0];
    return { ...row, snapshot: Buffer.from(row.snapshot as unknown as string, "hex") };
  }

  /** All save slots of a user, newest first — metadata only, no snapshot bytes. */
  async listSlots(userId: string): Promise<SlotMetaRow[]> {
    const { rows } = await this.pool.query<SlotMetaRow>(
      `select id, label, device, age_years, created_at
         from save_slots
        where user_id = $1
        order by created_at desc`,
      [userId],
    );
    return rows;
  }

  /**
   * Load one save slot, **user-scoped**, returning the full row including the
   * snapshot. Used to restore a snapshot into a running pet; null when the slot
   * does not exist or belongs to someone else.
   */
  async getSlot(userId: string, slotId: string): Promise<SlotRow | null> {
    const { rows } = await this.pool.query<SlotRow & { snapshot: string }>(
      `select id, user_id, label, encode(snapshot, 'hex') as snapshot, device, age_years, created_at
         from save_slots
        where id = $1 and user_id = $2`,
      [slotId, userId],
    );
    const row = rows[0];
    if (!row) return null;
    return { ...row, snapshot: Buffer.from(row.snapshot, "hex") };
  }

  /** Delete one save slot, **user-scoped**. No-op when it is not the caller's. */
  async deleteSlot(userId: string, slotId: string): Promise<void> {
    await this.pool.query(`delete from save_slots where id = $1 and user_id = $2`, [slotId, userId]);
  }
}
