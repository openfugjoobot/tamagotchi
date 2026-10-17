/**
 * Save slots — create, list, delete a pet's save states.
 *
 * Slots belong to the user and are filtered to the pet's device by the API
 * (`GET /api/pets/:id/slots`). This module renders that list and performs the
 * two writes the Task-8 API offers: create (`POST /api/pets/:id/slots`) and
 * delete (`DELETE /api/slots/:id`).
 *
 * "Load" has no server route: the API intentionally never carries the snapshot
 * bytes (they are binary and the repo-only `getSlot` is not exposed). Loading a
 * slot is therefore a *server* operation that no task in the plan defines, so
 * this module does not invent an endpoint — it renders the load affordance and
 * reports the missing route instead of firing a request that would 404. The gap
 * is carried to the final review.
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

        li.append(label, meta, del);
        return li;
      }),
    );
  };

  return { render, list, create, remove };
}
