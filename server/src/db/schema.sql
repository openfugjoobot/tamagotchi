-- Tamagotchi server schema (spec §3).
--
-- Deliberate omissions, both because the value cannot be derived from the ROM:
--   * `beeps` has no `kind`           — only *that* it beeped is known.
--   * `pets`  has no `cause_of_death` — death is read from the angel frame.
-- `died_at` is the only death information the schema stores.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  google_sub text unique not null,
  email text, name text, picture text,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists pets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  device text not null check (device in ('p1','p2')),
  rom_ver text not null,
  name text,
  state bytea,
  state_ver int not null default 1,
  born_at timestamptz not null default now(),
  age_years int not null default 0,
  alive boolean not null default true,
  died_at timestamptz,
  last_tick_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists push_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null, auth text not null,
  ua text, created_at timestamptz not null default now(),
  last_ok_at timestamptz, failed_at timestamptz
  -- The per-user uniqueness key is added by the ALTER below, not inline here:
  -- that keeps re-running this file idempotent on both a fresh and an already
  -- migrated database (Postgres has no `add constraint if not exists`).
);

-- Uniqueness is per user, not global: a bare `endpoint text unique` let any
-- authenticated user collide with (and, via the upsert, reassign) another
-- user's row by presenting the same endpoint string. Scoping the key to
-- `(user_id, endpoint)` keeps re-subscribing idempotent *within* one account
-- without making endpoints a cross-user namespace.
--
-- Upgrade path for databases created before this fix. The old inline
-- `endpoint text unique` is a global unique constraint named
-- `push_subs_endpoint_key` in Postgres; drop it. Drop any stale compound key
-- too, then (re)add it. Every statement is idempotent, so the schema can be
-- re-run on every boot (spec §3/§9).
alter table push_subs drop constraint if exists push_subs_endpoint_key;
alter table push_subs drop constraint if exists push_subs_user_endpoint_key;
alter table push_subs add constraint push_subs_user_endpoint_key
  unique (user_id, endpoint);

create table if not exists save_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  label text not null, snapshot bytea not null,
  device text not null, age_years int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists beeps (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references pets(id) on delete cascade,
  at timestamptz not null default now(),
  notified_at timestamptz
);
