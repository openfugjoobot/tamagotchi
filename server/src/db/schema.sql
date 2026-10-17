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
  endpoint text unique not null,
  p256dh text not null, auth text not null,
  ua text, created_at timestamptz not null default now(),
  last_ok_at timestamptz, failed_at timestamptz
);

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
