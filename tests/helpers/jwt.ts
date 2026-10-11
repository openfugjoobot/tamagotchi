// Test-Hilfen: eigener RSA-Schlüssel + selbst signierte JWTs.
// So lässt sich die Token-Prüfung komplett ohne Google-Zugang testen.
export interface TestKey {
  priv: CryptoKey;
  jwk: JsonWebKey;
}

export async function makeTestKey(): Promise<TestKey> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { priv: pair.privateKey, jwk };
}

function b64u(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signJwt(priv: CryptoKey, payload: Record<string, unknown>, kid = "test"): Promise<string> {
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const body = b64u(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", priv, new TextEncoder().encode(`${header}.${body}`)));
  return `${header}.${body}.${b64u(sig)}`;
}

/** fetch-Ersatz, der ein selbstgebautes JWKS liefert. */
export function jwksFetch(jwk: JsonWebKey, kid = "test"): typeof fetch {
  const impl = async (): Promise<Response> =>
    new Response(JSON.stringify({ keys: [{ ...jwk, kid }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  return impl as unknown as typeof fetch;
}
