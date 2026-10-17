import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { WsHub } from "../server/src/ws";
import { verifyIdToken, resetJwksCache, type TokenClaims } from "../server/src/auth";
import { makeTestKey, signJwt, jwksFetch, type TestKey } from "./helpers/jwt";

const CLIENT = "1234.apps.googleusercontent.com";
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

/** Minimal pet stub: a controllable LCD buffer plus a press recorder. */
class FakePet {
  lcdBuf = new Uint8Array(512);
  presses: string[] = [];
  lcd(): Uint8Array {
    return this.lcdBuf;
  }
  press(btn: string): void {
    this.presses.push(btn);
  }
  setPixel(i: number, v: number): void {
    this.lcdBuf[i] = v;
  }
}

/**
 * A pet source: user "user-1" owns pet "pet-1"; any other id is unknown. This
 * is the shape `main.ts` fills from `Repo.listPets`.
 */
function loadPet(pet: FakePet) {
  return async (userId: string, petId: string): Promise<{ pet: FakePet; alive: boolean; ageYears: number }> => {
    if (userId !== "user-1" || petId !== "pet-1") throw new Error("unknown pet");
    return { pet, alive: true, ageYears: 2 };
  };
}

/**
 * Real token verification against a self-built JWKS: the same `verifyIdToken`
 * the production hub uses, so the auth path under test is the real one.
 */
function verifyWith(key: TestKey) {
  return (token: string, clientId: string): Promise<TokenClaims> =>
    verifyIdToken(token, clientId, { fetchImpl: jwksFetch(key.jwk), now: NOW });
}

function goodToken(key: TestKey): Promise<string> {
  return signJwt(key.priv, {
    sub: "user-1",
    aud: CLIENT,
    iss: "https://accounts.google.com",
    exp: Math.floor(NOW / 1000) + 3600,
    email: "a@example.com",
  });
}

function waitForMessage(ws: WebSocket, predicate: (m: any) => boolean, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMsg);
      reject(new Error("timeout waiting for message"));
    }, timeoutMs);
    function onMsg(data: Buffer): void {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off("message", onMsg);
        resolve(msg);
      }
    }
    ws.on("message", onMsg);
  });
}

describe("WsHub", () => {
  let server: Server;
  let port = 0;
  let hub: WsHub;
  let key: TestKey;
  let token: string;

  beforeEach(async () => {
    resetJwksCache();
    key = await makeTestKey();
    token = await goodToken(key);
  });
  afterEach(async () => {
    await hub.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  async function startHub(pet: FakePet): Promise<WsHub> {
    server = createServer();
    hub = new WsHub({
      verify: verifyWith(key),
      loadPet: loadPet(pet),
      clientId: CLIENT,
    });
    hub.attach(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as { port: number }).port;
    return hub;
  }

  it("rejects a hello with an invalid token", async () => {
    const pet = new FakePet();
    await startHub(pet);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    ws.send(JSON.stringify({ t: "hello", token: "wrong", petId: "pet-1" }));
    // The server should close the socket (auth failure), not leave it hanging.
    await new Promise<void>((r) => ws.on("close", () => r()));
    expect(ws.readyState).toBe(WebSocket.CLOSED);
    expect(hub.hasLiveConnection("user-1")).toBe(false);
  });

  it("streams frames on change and marks the user live", async () => {
    const pet = new FakePet();
    await startHub(pet);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));

    const frameP = waitForMessage(ws, (m) => m.t === "frame");
    ws.send(JSON.stringify({ t: "hello", token, petId: "pet-1" }));
    const frame = await frameP;
    expect(frame.lcd).toHaveLength(512);
    expect(hub.hasLiveConnection("user-1")).toBe(true);

    // A second frame arrives only after the LCD actually changes.
    pet.setPixel(0, 1);
    const frame2P = waitForMessage(ws, (m) => m.t === "frame" && m.lcd[0] === 1);
    hub.notifyChanged();
    const frame2 = await frame2P;
    expect(frame2.lcd[0]).toBe(1);
  });

  it("sends a state message with alive and age", async () => {
    const pet = new FakePet();
    await startHub(pet);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    const stateP = waitForMessage(ws, (m) => m.t === "state");
    ws.send(JSON.stringify({ t: "hello", token, petId: "pet-1" }));
    const state = await stateP;
    expect(state).toMatchObject({ t: "state", alive: true, ageYears: 2 });
  });

  it("forwards a button press to the bound pet", async () => {
    const pet = new FakePet();
    await startHub(pet);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    ws.send(JSON.stringify({ t: "hello", token, petId: "pet-1" }));
    await waitForMessage(ws, (m) => m.t === "state");
    ws.send(JSON.stringify({ t: "press", btn: "middle" }));
    // The hub performs the press synchronously; poll briefly.
    await new Promise((r) => setTimeout(r, 50));
    expect(pet.presses).toEqual(["middle"]);
  });

  it("clears the live flag when the connection closes", async () => {
    const pet = new FakePet();
    await startHub(pet);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    ws.send(JSON.stringify({ t: "hello", token, petId: "pet-1" }));
    await waitForMessage(ws, (m) => m.t === "state");
    expect(hub.hasLiveConnection("user-1")).toBe(true);
    ws.close();
    await new Promise<void>((r) => ws.on("close", () => r()));
    expect(hub.hasLiveConnection("user-1")).toBe(false);
  });

  it("ignores presses before a successful hello", async () => {
    const pet = new FakePet();
    await startHub(pet);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    ws.send(JSON.stringify({ t: "press", btn: "left" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(pet.presses).toEqual([]);
  });
});
