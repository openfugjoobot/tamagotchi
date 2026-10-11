import { describe, it, expect } from "vitest";
import { decideSync, hasConflict, pullSave, pushSave, deleteRemote } from "@/sync/cloud";

describe("sync: Entscheidung beim Start", () => {
  const cloud = (iso: string) => iso;

  it("nichts da → nichts tun", () => {
    expect(decideSync(null, null)).toBe("none");
  });
  it("nur lokal → hochladen", () => {
    expect(decideSync(Date.parse("2026-01-01T10:00:00Z"), null)).toBe("push");
  });
  it("nur in der Cloud → laden", () => {
    expect(decideSync(null, cloud("2026-01-01T10:00:00Z"))).toBe("pull");
  });
  it("Cloud neuer → laden", () => {
    expect(decideSync(Date.parse("2026-01-01T09:00:00Z"), "2026-01-01T10:00:00Z")).toBe("pull");
  });
  it("lokal neuer → hochladen", () => {
    expect(decideSync(Date.parse("2026-01-01T11:00:00Z"), "2026-01-01T10:00:00Z")).toBe("push");
  });
  it("gleich alt → nichts", () => {
    expect(decideSync(Date.parse("2026-01-01T10:00:00Z"), "2026-01-01T10:00:00Z")).toBe("none");
  });
  it("kaputter Zeitstempel in der Cloud → lokal gewinnt", () => {
    expect(decideSync(Date.parse("2026-01-01T10:00:00Z"), "keinDatum")).toBe("push");
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

describe("sync: Konflikt erkennen", () => {
  it("nur wenn beide Stände existieren und abweichen", () => {
    const t = Date.parse("2026-01-01T10:00:00Z");
    expect(hasConflict(t, null)).toBe(false);
    expect(hasConflict(null, "2026-01-01T10:00:00Z")).toBe(false);
    expect(hasConflict(t, "2026-01-01T10:00:00Z")).toBe(false);
    expect(hasConflict(t, "2026-01-01T11:00:00Z")).toBe(true);
    expect(hasConflict(t, "2025-12-31T23:00:00Z")).toBe(true);
    expect(hasConflict(t, "keinDatum")).toBe(false);
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

  it("GET liefert den Stand oder null", async () => {
    const seen = emptySeen();
    const rec = await pullSave("t", {
      fetchImpl: stubFetch(() => new Response(JSON.stringify({ snapshot: "X", updatedAt: "2026-01-01T10:00:00.000Z" }), { status: 200 }), seen),
    });
    expect(rec?.snapshot).toBe("X");

    const empty = await pullSave("t", { fetchImpl: stubFetch(() => new Response(null, { status: 404 }), emptySeen()) });
    expect(empty).toBeNull();
  });

  it("Netzfehler sind kein Absturz", async () => {
    const boom = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await pullSave("t", { fetchImpl: boom })).toBeNull();
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
