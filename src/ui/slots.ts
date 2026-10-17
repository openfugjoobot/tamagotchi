/**
 * Save slots — create, load, list, delete a pet's save states.
 *
 * Slots belong to the user and are filtered to the pet's device by the API
 * (`GET /api/pets/:id/slots`). This module renders that list and performs the
 * three writes the API offers: create (`POST /api/pets/:id/slots`), load
 * (`POST /api/pets/:id/slots/:slotId/load`), and delete (`DELETE /api/slots/:id`).
 *
 * Loading restores the snapshot **server-side** (the API never ships the binary
 * bytes to the client): the request names the pet and the slot, the server
 * validates ownership + device and rewrites the running emulator's state. The
 * tab then receives the new frames over the live channel like any other tick.
 */

import { api } from "./api";
import { t } from "../i18n";

export interface SlotSummary {
  id: string;
  label: string;
  device: string;
  ageYears: number;
  createdAt: string;
}

export interface SlotsDeps {
  token: () => string | null;
  /** Host element for the rendered list. Optional (tests omit it). */
  host?: HTMLElement;
  /** A user-facing message channel (the app's toast). */
  notify?: (msg: string) => void;
  /** Called after a successful create/delete so the caller can refresh. */
  onChange?: () => void;
}

export interface SlotsView {
  render(slots: SlotSummary[], petId: string): void;
  list(petId: string): Promise<SlotSummary[]>;
  create(petId: string, label: string): Promise<boolean>;
  load(slotId: string, petId: string): Promise<boolean>;
  remove(slotId: string, petId: string): Promise<boolean>;
}

/** Validate a label the same way the API does (non-empty after trim). */
export function validSlotLabel(label: string): boolean {
  return label.trim().length > 0;
}

export function createSlotsView(deps: SlotsDeps): SlotsView {
  const list = async (petId: string): Promise<SlotSummary[]> => {
    const res = await api.get<SlotSummary[]>(`/api/pets/${petId}/slots`, deps.token());
    return res.ok && Array.isArray(res.data) ? res.data : [];
  };

  const create = async (petId: string, label: string): Promise<boolean> => {
    if (!validSlotLabel(label)) return false;
    const res = await api.post<SlotSummary>(`/api/pets/${petId}/slots`, deps.token(), { label: label.trim() });
    if (res.ok) {
      deps.notify?.(t("slotCreated"));
      deps.onChange?.();
      return true;
    }
    return false;
  };

  const load = async (slotId: string, petId: string): Promise<boolean> => {
    const res = await api.post<{ ok: true }>(`/api/pets/${petId}/slots/${slotId}/load`, deps.token(), {});
    if (res.ok) {
      deps.notify?.(t("slotLoaded"));
      deps.onChange?.();
      return true;
    }
    return false;
  };

  const remove = async (slotId: string, petId: string): Promise<boolean> => {
    const res = await api.del<null>(`/api/slots/${slotId}`, deps.token());
    if (res.ok) {
      deps.notify?.(t("slotDeleted"));
      deps.onChange?.();
      // Keep the caller's list fresh for the pet it was showing.
      void list(petId);
      return true;
    }
    return false;
  };

  const render = (slots: SlotSummary[], petId: string): void => {
    const host = deps.host;
    if (!host) return;
    if (slots.length === 0) {
      const empty = document.createElement("p");
      empty.className = "slots-empty";
      empty.textContent = t("slotsEmpty");
      host.replaceChildren(empty);
      return;
    }
    host.replaceChildren(
      ...slots.map((s) => {
        const li = document.createElement("li");
        li.className = "slot-row";
        li.dataset.slotId = s.id;

        const label = document.createElement("span");
        label.className = "slot-label";
        label.textContent = s.label;

        const meta = document.createElement("span");
        meta.className = "slot-meta";
        meta.textContent = `${t("petAge")}: ${s.ageYears}`;

        const del = document.createElement("button");
        del.type = "button";
        del.className = "slot-del";
        del.textContent = t("slotDelete");
        del.setAttribute("aria-label", t("slotDelete"));
        del.addEventListener("click", () => void remove(s.id, petId));

        const loadBtn = document.createElement("button");
        loadBtn.type = "button";
        loadBtn.className = "slot-load";
        loadBtn.textContent = t("slotLoad");
        loadBtn.setAttribute("aria-label", t("slotLoad"));
        loadBtn.addEventListener("click", () => void load(s.id, petId));

        li.append(label, meta, loadBtn, del);
        return li;
      }),
    );
  };

  return { render, list, create, load, remove };
}
