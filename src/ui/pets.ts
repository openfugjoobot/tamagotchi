/**
 * The pet list — the user's pets, the living one on top and the dead below.
 *
 * Two pieces, deliberately split so the list logic is testable without a DOM
 * (this project runs its tests in plain Node, no jsdom):
 *
 *   * `buildPetsView()` is pure: it turns a `GET /api/pets` payload into rows.
 *   * `createPetsView()` wires selection to a `LiveClient` and renders rows
 *     into a host element when one is present.
 *
 * What a row may say: the pet's age and, for a dead pet, the moment it died.
 * What it must never say: a *cause* of death. The ROM exposes none — death is
 * recognised at the angel frame and nothing else is knowable (spec §3/§4, and
 * the API never emits such a field). `diedAt` is therefore the whole story.
 */

import type { LiveClient } from "../net/live";
import type { Device } from "../emu/devices";
import { t } from "../i18n";
import { formatDate } from "./format";

/** A pet as `GET /api/pets` returns it (see server/src/api.ts `petDto`). */
export interface PetSummary {
  id: string;
  device: Device;
  name: string | null;
  alive: boolean;
  ageYears: number;
  bornAt: string | null;
  diedAt: string | null;
}

/** One rendered row. Note the total absence of a cause field — by design. */
export interface PetRowView {
  id: string;
  device: Device;
  alive: boolean;
  ageYears: number;
  /** ISO timestamp of death, or null while alive. */
  diedAt: string | null;
  /** Is this the pet the tab is currently showing? */
  current: boolean;
}

/**
 * Build the ordered row list: living pets first (newest first, as the API
 * returns them), then the dead ones. This is the whole ordering contract —
 * "aktuelles Tier oben, gestorbene darunter".
 *
 * Pure: same input, same output; no DOM, no clock, no network.
 */
export function buildPetsView(pets: PetSummary[], currentPetId: string | null = null): PetRowView[] {
  const rows: PetRowView[] = pets.map((p) => ({
    id: p.id,
    device: p.device,
    alive: p.alive,
    ageYears: p.ageYears,
    diedAt: p.alive ? null : p.diedAt,
    current: p.id === currentPetId,
  }));
  // Stable partition: alive rows keep their order, dead rows keep theirs.
  return [...rows.filter((r) => r.alive), ...rows.filter((r) => !r.alive)];
}

export interface PetsViewDeps {
  /** The live client; `select()` binds the chosen pet to it. */
  live: Pick<LiveClient, "connect">;
  /** The current ID token, read at selection time. */
  token: () => string | null;
  /** Host element for the rendered rows. Optional (tests omit it). */
  host?: HTMLElement;
  /** Called after a successful selection, e.g. to close the menu. */
  onSelect?: (petId: string) => void;
}

export interface PetsView {
  /** Render a payload into the host (no-op without a host). */
  render(pets: PetSummary[], currentPetId?: string | null): void;
  /** Bind a pet to the live client. Does nothing without a token. */
  select(petId: string): void;
}

/**
 * Wire the pet list to a `LiveClient`.
 *
 * `select()` is the one side effect in this module: it hands the chosen pet's
 * id (and the current token) to `LiveClient.connect`, which restarts the stream
 * for that pet. Rendering stays pure and reuses `buildPetsView`.
 */
export function createPetsView(deps: PetsViewDeps): PetsView {
  const select = (petId: string): void => {
    const token = deps.token();
    if (!token) return;
    deps.live.connect(petId, token);
    deps.onSelect?.(petId);
  };

  const render = (pets: PetSummary[], currentPetId: string | null = null): void => {
    const host = deps.host;
    if (!host) return;
    const rows = buildPetsView(pets, currentPetId);
    host.replaceChildren(...rows.map((r) => renderRow(r, select)));
  };

  return { render, select };
}

/** Build one row's DOM. Kept separate so `render()` stays a thin loop. */
function renderRow(row: PetRowView, onSelect: (petId: string) => void): HTMLElement {
  const li = document.createElement("li");
  li.className = "pet-row";
  li.dataset.petId = row.id;
  li.dataset.alive = String(row.alive);
  li.dataset.device = row.device;
  if (row.current) li.classList.add("current");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pet-pick";
  btn.setAttribute("aria-current", row.current ? "true" : "false");

  const title = document.createElement("span");
  title.className = "pet-title";
  // The device label is the only self-description a pet has; there is no name
  // and, by design, no cause.
  title.textContent = row.device.toUpperCase();

  const meta = document.createElement("span");
  meta.className = "pet-meta";
  const age = `${t("petAge")}: ${row.ageYears}`;
  meta.textContent = row.alive || !row.diedAt
    ? `${age} · ${t("petAlive")}`
    : `${age} · ${t("petDied")} ${formatDate(row.diedAt)}`;

  btn.append(title, meta);
  btn.addEventListener("click", () => onSelect(row.id));
  li.append(btn);
  return li;
}
