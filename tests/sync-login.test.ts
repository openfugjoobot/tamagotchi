import { describe, it, expect } from "vitest";
import { readSave, planSync } from "@/sync/cloud";

// Diese Tests beschreiben das GEWUENSCHTE Verhalten des Login-Abgleichs.
// Sie sind zuerst rot und dokumentieren damit den aktuellen Bug:
//   * pullSave wirft "keine Cloud" (404) und "Abruf gescheitert" (Netz/5xx)
//     in denselben Wert null. Der Login-Pfad macht daraus einen stillen Upload.
//   * applyCloudSave(..., true) laedt die Seite neu und killt damit die
//     sessionStorage-Session, sodass syncBeforeBoot beim naechsten Boot
//     wieder aussteigt.

/** Antwort-Stub: (status, body) ohne Netz. */
function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const withFetch = (status: number, body?: unknown) => ({
  fetchImpl: (async () => reply(status, body)) as unknown as typeof fetch,
  api: "/api/save",
});

describe("readSave: unterscheidet 'keine Cloud' von 'Abruf gescheitert'", () => {
  it("404 = absent (die Cloud hat wirklich keinen Stand)", async () => {
    const r = await readSave("tok", withFetch(404));
    expect(r.kind).toBe("absent");
  });

  it("200 mit Snapshot = found", async () => {
    const r = await readSave("tok", withFetch(200, { snapshot: "S", updatedAt: "2026-01-01T10:00:00.000Z" }));
    expect(r.kind).toBe("found");
    if (r.kind === "found") expect(r.save.snapshot).toBe("S");
  });

  it("Netzfehler = error (NICHT absent)", async () => {
    const boom = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const r = await readSave("tok", { fetchImpl: boom, api: "/api/save" });
    expect(r.kind).toBe("error");
  });

  it("500 = error (NICHT absent)", async () => {
    const r = await readSave("tok", withFetch(500));
    expect(r.kind).toBe("error");
  });

  it("200 mit kaputtem Body = error (NICHT absent)", async () => {
    const r = await readSave("tok", withFetch(200, { nothing: true }));
    expect(r.kind).toBe("error");
  });

  it("Timeout = error", async () => {
    // Ein Fetch, der nie antwortet, muss in den Timeout laufen und darf
    // nicht als 'absent' durchgehen.
    const never = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const r = await readSave("tok", { fetchImpl: never, api: "/api/save", timeoutMs: 30 });
    expect(r.kind).toBe("error");
  });
});

describe("planSync: der stille Upload darf nicht passieren", () => {
  const local = 1000; // lokaler Stand vorhanden

  it("Cloud-Abruf gescheitert -> NICHTS tun (nicht hochladen)", () => {
    // Das ist der Kern des Bugs: ein fehlgeschlagener Abruf ist kein Beweis
    // fuer 'keine Cloud'. Der lokale Stand darf NICHT still hochgeschoben werden.
    expect(planSync({ kind: "error", reason: "offline" }, local)).toBe("none");
    expect(planSync({ kind: "error", reason: "timeout" }, null)).toBe("none");
  });

  it("Cloud hat keinen Stand, lokal schon -> hochladen", () => {
    expect(planSync({ kind: "absent" }, local)).toBe("push");
  });

  it("Cloud hat keinen Stand, lokal auch nicht -> nichts", () => {
    expect(planSync({ kind: "absent" }, null)).toBe("none");
  });

  it("Cloud neuer -> nachfragen (kein stiller Upload, kein stiller Pull)", () => {
    expect(planSync({ kind: "found", save: { snapshot: "S", updatedAt: "2026-01-01T10:00:00.000Z" } }, Date.parse("2026-01-01T09:00:00.000Z"))).toBe("ask");
  });

  it("lokal neuer -> nachfragen (frisches Ei darf die Cloud nicht still ueberschreiben)", () => {
    expect(planSync({ kind: "found", save: { snapshot: "S", updatedAt: "2026-01-01T09:00:00.000Z" } }, Date.parse("2026-01-01T10:00:00.000Z"))).toBe("ask");
  });

  it("nur in der Cloud (frischer Browser) -> laden, NIE hochladen", () => {
    expect(planSync({ kind: "found", save: { snapshot: "S", updatedAt: "2026-01-01T10:00:00.000Z" } }, null)).toBe("pull");
  });

  it("beide vorhanden, egal wie alt -> immer nachfragen", () => {
    const t = "2026-01-01T10:00:00.000Z";
    expect(planSync({ kind: "found", save: { snapshot: "S", updatedAt: t } }, Date.parse(t))).toBe("ask");
  });
});
