import { describe, it, expect } from "vitest";
import { needsPrompt, readSave, planSync, pushSave, deleteRemote } from "@/sync/cloud";

describe("sync: Entscheidung beim Start (planSync)", () => {
  const found = (iso: string) => ({ kind: "found" as const, save: { snapshot: "S", updatedAt: iso } });

  it("nichts da → nichts tun", () => {
    expect(planSync({ kind: "absent" }, null)).toBe("none");
  });
  it("nur lokal → hochladen", () => {
    expect(planSync({ kind: "absent" }, 1000)).toBe("push");
  });
  it("nur in der Cloud → laden", () => {
    expect(planSync(found("2026-01-01T10:00:00Z"), null)).toBe("pull");
  });
  it("beide da (Cloud neuer) → nachfragen, nicht still überschreiben", () => {
    expect(planSync(found("2026-01-01T10:00:00Z"), Date.parse("2026-01-01T09:00:00Z"))).toBe("ask");
  });
  it("beide da (lokal neuer, z. B. frisches Ei) → nachfragen", () => {
    expect(planSync(found("2026-01-01T09:00:00Z"), Date.parse("2026-01-01T10:00:00Z"))).toBe("ask");
  });
  it("Abruf gescheitert → nichts tun", () => {
    expect(planSync({ kind: "error", reason: "offline" }, 1000)).toBe("none");
    expect(planSync({ kind: "error", reason: "timeout" }, null)).toBe("none");
  });
});

interface Seen {
  url: string;
  method: string;
  auth: string;
  body: string;
}

function stubFetch(reply: () => Response, seen: Seen): typeof fetch {
  const impl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    seen.url = String(url);
    seen.method = init?.method ?? "GET";
    seen.auth = String((init?.headers as Record<string, string> | undefined)?.authorization ?? "");
    seen.body = typeof init?.body === "string" ? init.body : "";
    return reply();
  };
  return impl as unknown as typeof fetch;
}

const emptySeen = (): Seen => ({ url: "", method: "", auth: "", body: "" });

describe("sync: Nachfrage wenn BEIDE Seiten einen Stand haben", () => {
  it("nur wenn lokal UND Cloud vorhanden sind", () => {
    const t = Date.parse("2026-01-01T10:00:00Z");
    expect(needsPrompt(t, null)).toBe(false);
    expect(needsPrompt(null, "2026-01-01T10:00:00Z")).toBe(false);
    expect(needsPrompt(t, "2026-01-01T10:00:00Z")).toBe(true);
    expect(needsPrompt(t, "2026-01-01T11:00:00Z")).toBe(true);
    expect(needsPrompt(t, "2025-12-31T23:00:00Z")).toBe(true);
    expect(needsPrompt(t, "keinDatum")).toBe(false);
  });
});

describe("sync: API-Aufrufe", () => {
  it("PUT schickt Methode, Header und Body", async () => {
    const seen = emptySeen();
    const ok = await pushSave("tok123", { snapshot: "SNAP", updatedAt: "2026-01-01T10:00:00.000Z" }, {
      fetchImpl: stubFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }), seen),
      api: "/api/save",
    });
    expect(ok).toBe(true);
    expect(seen.url).toBe("/api/save");
    expect(seen.method).toBe("PUT");
    expect(seen.auth).toMatch(/^Bearer\s+tok123$/);
    expect(JSON.parse(seen.body)).toMatchObject({ snapshot: "SNAP" });
  });

  it("GET liefert found oder absent", async () => {
    const rec = await readSave("t", {
      fetchImpl: stubFetch(() => new Response(JSON.stringify({ snapshot: "X", updatedAt: "2026-01-01T10:00:00.000Z" }), { status: 200 }), emptySeen()),
      api: "/api/save",
    });
    expect(rec.kind).toBe("found");
    if (rec.kind === "found") expect(rec.save.snapshot).toBe("X");

    const empty = await readSave("t", { fetchImpl: stubFetch(() => new Response(null, { status: 404 }), emptySeen()) });
    expect(empty.kind).toBe("absent");
  });

  it("Netzfehler sind kein Absturz", async () => {
    const boom = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect((await readSave("t", { fetchImpl: boom })).kind).toBe("error");
    expect(await pushSave("t", { snapshot: "x", updatedAt: "2026-01-01T00:00:00.000Z" }, { fetchImpl: boom })).toBe(false);
    expect(await deleteRemote("t", { fetchImpl: boom })).toBe(false);
  });

  it("DELETE ruft die richtige Methode", async () => {
    const seen = emptySeen();
    const ok = await deleteRemote("t", { fetchImpl: stubFetch(() => new Response(null, { status: 200 }), seen) });
    expect(ok).toBe(true);
    expect(seen.method).toBe("DELETE");
  });
});
