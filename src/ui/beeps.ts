/**
 * Beep history — the missed events, as `GET /api/beeps` returns them.
 *
 * The list carries no *kind*: a beep's cause is not knowable from the ROM, so
 * the API emits `{id, petId, at, notified}` only (spec §3, server/src/api.ts).
 * The wording is therefore generic and identical for every entry — there is
 * exactly one beep sentence, not one per category.
 */

import { t } from "../i18n";

/** A beep as `GET /api/beeps` returns it. No `kind`, by design. */
export interface BeepSummary {
  id: string;
  petId: string;
  at: string;
  notified: boolean;
}

/** One rendered beep row: a generic sentence plus the time and send state. */
export interface BeepRowView {
  id: string;
  at: string;
  notified: boolean;
  /** The generic, kind-independent sentence (i18n `beepGeneric`). */
  text: string;
}

/** Format an ISO timestamp for display, falling back to the raw string. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return d.toISOString();
  }
}

/**
 * Map a beep payload to rows. Pure: the text is the same for every beep —
 * there is no per-kind branch to write, because there is no kind.
 */
export function buildBeepsView(beeps: BeepSummary[]): BeepRowView[] {
  return beeps.map((b) => ({
    id: b.id,
    at: b.at,
    notified: b.notified,
    text: t("beepGeneric"),
  }));
}

export interface BeepsViewDeps {
  /** Host element for the rendered list. Optional (tests omit it). */
  host?: HTMLElement;
}

export interface BeepsView {
  render(beeps: BeepSummary[]): void;
}

export function createBeepsView(deps: BeepsViewDeps): BeepsView {
  const render = (beeps: BeepSummary[]): void => {
    const host = deps.host;
    if (!host) return;
    const rows = buildBeepsView(beeps);
    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "beeps-empty";
      empty.textContent = t("beepsEmpty");
      host.replaceChildren(empty);
      return;
    }
    host.replaceChildren(
      ...rows.map((r) => {
        const li = document.createElement("li");
        li.className = "beep-row";
        li.dataset.beepId = r.id;

        const text = document.createElement("span");
        text.className = "beep-text";
        text.textContent = r.text;

        const meta = document.createElement("span");
        meta.className = "beep-meta";
        const state = r.notified ? t("beepNotified") : t("beepNotSent");
        meta.textContent = `${t("beepAt")} ${formatDate(r.at)} · ${state}`;

        li.append(text, meta);
        return li;
      }),
    );
  };

  return { render };
}
