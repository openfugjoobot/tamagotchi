import { describe, it, expect, beforeEach } from "vitest";
import { verifyIdToken, resetJwksCache } from "../server/src/auth";
import { makeTestKey, signJwt, jwksFetch } from "./helpers/jwt";

const CLIENT = "1234.apps.googleusercontent.com";
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

function claims(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: "user-1",
    aud: CLIENT,
    iss: "https://accounts.google.com",
    exp: Math.floor(NOW / 1000) + 3600,
    email: "a@example.com",
    name: "A",
    ...over,
  };
}

describe("worker: Google-ID-Token", () => {
  beforeEach(() => resetJwksCache());

  it("akzeptiert ein gültig signiertes Token", async () => {
    const k = await makeTestKey();
    const token = await signJwt(k.priv, claims());
    const c = await verifyIdToken(token, CLIENT, { fetchImpl: jwksFetch(k.jwk), now: NOW });
    expect(c.sub).toBe("user-1");
    expect(c.email).toBe("a@example.com");
  });

  it("lehnt fremde audience ab", async () => {
    const k = await makeTestKey();
    const token = await signJwt(k.priv, claims({ aud: "anderer-client" }));
    await expect(verifyIdToken(token, CLIENT, { fetchImpl: jwksFetch(k.jwk), now: NOW })).rejects.toThrow(/audience/);
  });

  it("lehnt abgelaufene Token ab", async () => {
    const k = await makeTestKey();
    const token = await signJwt(k.priv, claims({ exp: Math.floor(NOW / 1000) - 10 }));
    await expect(verifyIdToken(token, CLIENT, { fetchImpl: jwksFetch(k.jwk), now: NOW })).rejects.toThrow(/expired/);
  });

  it("lehnt falschen Aussteller ab", async () => {
    const k = await makeTestKey();
    const token = await signJwt(k.priv, claims({ iss: "https://evil.example" }));
    await expect(verifyIdToken(token, CLIENT, { fetchImpl: jwksFetch(k.jwk), now: NOW })).rejects.toThrow(/issuer/);
  });

  it("lehnt manipulierte Nutzlast ab (Signatur passt nicht mehr)", async () => {
    const k = await makeTestKey();
    const good = await signJwt(k.priv, claims());
    const [h, , s] = good.split(".");
    const forged = btoa(JSON.stringify(claims({ sub: "hacker" }))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    await expect(verifyIdToken(`${h}.${forged}.${s}`, CLIENT, { fetchImpl: jwksFetch(k.jwk), now: NOW })).rejects.toThrow(/signature/);
  });

  it("lehnt unbekannte Schlüssel-ID ab", async () => {
    const k = await makeTestKey();
    const token = await signJwt(k.priv, claims(), "fremder-kid");
    await expect(verifyIdToken(token, CLIENT, { fetchImpl: jwksFetch(k.jwk, "test"), now: NOW })).rejects.toThrow(/key/);
  });

  it("lehnt unsinnige Token ab", async () => {
    const k = await makeTestKey();
    await expect(verifyIdToken("nonsense", CLIENT, { fetchImpl: jwksFetch(k.jwk), now: NOW })).rejects.toThrow(/malformed/);
  });
});
