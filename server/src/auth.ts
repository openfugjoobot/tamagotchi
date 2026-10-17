// Prüft Googles ID-Token (JWT) ohne Secrets: Signatur gegen das öffentliche JWKS,
// danach aud/iss/exp/sub. Läuft in Node (und in Tests unverändert mit injiziertem fetch).

export interface TokenClaims {
  sub: string;
  aud: string;
  iss: string;
  exp: number;
  email?: string;
  name?: string;
  picture?: string;
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const JWKS_TTL_MS = 60 * 60 * 1000;

let cache: { keys: Jwk[]; at: number } | null = null;

function b64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function jsonPart<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(b64url(part))) as T;
}

async function keys(fetchImpl: typeof fetch, now: number): Promise<Jwk[]> {
  if (cache && now - cache.at < JWKS_TTL_MS) return cache.keys;
  const res = await fetchImpl(JWKS_URL);
  if (!res.ok) throw new Error("jwks unavailable");
  const body = (await res.json()) as { keys?: Jwk[] };
  cache = { keys: body.keys ?? [], at: now };
  return cache.keys;
}

export interface VerifyOptions {
  fetchImpl?: typeof fetch;
  now?: number;
}

export async function verifyIdToken(token: string, clientId: string, opts: VerifyOptions = {}): Promise<TokenClaims> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now();

  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const header = jsonPart<{ alg: string; kid: string }>(parts[0]);
  if (header.alg !== "RS256") throw new Error("unsupported alg");
  if (!header.kid) throw new Error("missing kid");

  const jwk = (await keys(fetchImpl, now)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("unknown key");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, new Uint8Array(b64url(parts[2])), new Uint8Array(signed));
  if (!ok) throw new Error("bad signature");

  const claims = jsonPart<TokenClaims>(parts[1]);
  if (claims.aud !== clientId) throw new Error("bad audience");
  if (!ISSUERS.includes(claims.iss)) throw new Error("bad issuer");
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) throw new Error("expired");
  if (!claims.sub) throw new Error("no subject");
  return claims;
}

/** Nur für Tests: JWKS-Cache leeren. */
export function resetJwksCache(): void {
  cache = null;
}
