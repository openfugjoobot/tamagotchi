// Cloudflare Worker: /api/save für den Spielstand pro Google-Konto.
// Same-origin unter tamagotchi.fugjoo.com/api/* → kein CORS nötig.
import { verifyIdToken, type TokenClaims } from "./auth";
import { isNewer, parseRecord, recordKey, type SaveRecord, type SaveStore } from "./store";

export interface Env {
  /** KV-Binding (siehe worker/wrangler.toml). */
  SAVES: SaveStore;
  /** Google-OAuth-Client-ID (öffentlich, kein Secret). */
  GOOGLE_CLIENT_ID: string;
}

const MAX_BODY = 64 * 1024; // Snapshots sind ~23 KB (base64+gzip)

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function bearer(req: Request): string | null {
  const raw = (req.headers.get("authorization") ?? "").trim();
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1].trim() : null;
}

export interface HandleDeps {
  fetchImpl?: typeof fetch;
  now?: number;
}

export async function handle(req: Request, env: Env, deps: HandleDeps = {}): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== "/api/save") return json({ error: "not found" }, 404);

  const token = bearer(req);
  if (!token) return json({ error: "unauthorized" }, 401);

  let claims: TokenClaims;
  try {
    claims = await verifyIdToken(token, env.GOOGLE_CLIENT_ID, deps);
  } catch {
    return json({ error: "unauthorized" }, 401);
  }

  const key = recordKey(claims.sub);

  if (req.method === "GET") {
    const rec = parseRecord(await env.SAVES.get(key));
    return rec ? json(rec) : json({ error: "empty" }, 404);
  }

  if (req.method === "PUT") {
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: "too large" }, 413);
    let body: SaveRecord;
    try {
      body = JSON.parse(text) as SaveRecord;
    } catch {
      return json({ error: "bad json" }, 400);
    }
    if (!body || typeof body.snapshot !== "string" || typeof body.updatedAt !== "string") {
      return json({ error: "bad body" }, 400);
    }
    const stored = parseRecord(await env.SAVES.get(key));
    if (!isNewer(body, stored)) return json({ skipped: true, updatedAt: stored?.updatedAt ?? null });
    await env.SAVES.put(
      key,
      JSON.stringify({ snapshot: body.snapshot, updatedAt: body.updatedAt, saveVer: body.saveVer ?? 1 }),
    );
    return json({ ok: true, updatedAt: body.updatedAt });
  }

  if (req.method === "DELETE") {
    await env.SAVES.delete(key);
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
};
