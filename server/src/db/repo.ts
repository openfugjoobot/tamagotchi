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

export interface BeepRow {
  id: string;
  pet_id: string;
  at: Date;
  notified_at: Date | null;
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

  /** Push subscriptions of a user. */
  async listPushSubs(userId: string): Promise<PushSubRow[]> {
    const { rows } = await this.pool.query<PushSubRow>(
      `select * from push_subs where user_id = $1 order by created_at desc`,
      [userId],
    );
    return rows;
  }

  /**
   * Register a push subscription. `endpoint` is unique, so re-subscribing the
   * same browser refreshes it in place instead of duplicating.
   */
  async addPushSub(userId: string, sub: PushSub): Promise<PushSubRow> {
    const { rows } = await this.pool.query<PushSubRow>(
      `insert into push_subs (user_id, endpoint, p256dh, auth, ua)
       values ($1, $2, $3, $4, $5)
       on conflict (endpoint) do update
         set user_id = excluded.user_id,
             p256dh = excluded.p256dh,
             auth = excluded.auth,
             ua = excluded.ua,
             failed_at = null
       returning *`,
      [userId, sub.endpoint, sub.p256dh, sub.auth, sub.ua ?? null],
    );
    return rows[0];
  }

  /** Drop a subscription by endpoint (used on `410 Gone`). No-op if absent. */
  async removePushSub(endpoint: string): Promise<void> {
    await this.pool.query(`delete from push_subs where endpoint = $1`, [endpoint]);
  }

  /** Record that a pet beeped. No cause is stored (spec §3 — no `kind`). */
  async recordBeep(petId: string): Promise<BeepRow> {
    const { rows } = await this.pool.query<BeepRow>(
      `insert into beeps (pet_id) values ($1) returning *`,
      [petId],
    );
    return rows[0];
  }

  /** Beeps not yet pushed to the user, oldest first. */
  async pendingBeeps(): Promise<BeepRow[]> {
    const { rows } = await this.pool.query<BeepRow>(
      `select * from beeps where notified_at is null order by at asc`,
    );
    return rows;
  }

  /** Mark a beep as delivered so it is not pushed again. */
  async markBeepNotified(id: string): Promise<void> {
    await this.pool.query(`update beeps set notified_at = now() where id = $1`, [id]);
  }
}
