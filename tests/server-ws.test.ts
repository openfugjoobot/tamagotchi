import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { WsHub } from "../server/src/ws";
import { verifyIdToken, resetJwksCache, type TokenClaims } from "../server/src/auth";
import { makeTestKey, signJwt, jwksFetch, type TestKey } from "./helpers/jwt";

const CLIENT = "1234.apps.googleusercontent.com";
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

/** Minimal pet stub: a controllable LCD buffer + icon buffer plus a press recorder. */
class FakePet {
  lcdBuf = new Uint8Array(512);
  iconBuf = new Uint8Array(8);
  presses: string[] = [];
  alive = true;
  lcd(): Uint8Array {
    return this.lcdBuf;
  }
  icons(): Uint8Array {
    return this.iconBuf;
  }
  press(btn: string): void {
    this.presses.push(btn);
  }
  dead(): boolean {
    return !this.alive;
  }
  setPixel(i: number, v: number): void {
    this.lcdBuf[i] = v;
  }
  setIcon(i: number, v: number): void {
    this.iconBuf[i] = v;
  }
}

/**
 * A pet source: token sub "user-1" owns pet "pet-1"; any other sub is unknown.
 * The loader returns the internal `userId` (the push-gate key) alongside the pet.
 */
function loadPet(pet: FakePet) {
  return async (sub: string, petId: string): Promise<{ pet: FakePet; alive: boolean; ageYears: number; userId: string }> => {
    if (sub !== "user-1" || petId !== "pet-1") throw new Error("unknown pet");
    return { pet, alive: true, ageYears: 2, userId: "uuid-user-1" };
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
    expect(hub.hasLiveConnection("uuid-user-1")).toBe(false);
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
    // The gate is keyed by the internal id the loader returned, not the token sub.
    expect(hub.hasLiveConnection("uuid-user-1")).toBe(true);

    // A second frame arrives only after the LCD actually changes.
    pet.setPixel(0, 1);
    const frame2P = waitForMessage(ws, (m) => m.t === "frame" && m.lcd[0] === 1);
    hub.notifyChanged();
    const frame2 = await frame2P;
    expect(frame2.lcd[0]).toBe(1);
  });

  it("carries the 8 icon-segment bits in every frame message", async () => {
    const pet = new FakePet();
    pet.setIcon(2, 1);
    pet.setIcon(5, 1);
    await startHub(pet);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));

    const frameP = waitForMessage(ws, (m) => m.t === "frame");
    ws.send(JSON.stringify({ t: "hello", token, petId: "pet-1" }));
    const frame = await frameP;
    expect(frame.icons).toEqual([0, 0, 1, 0, 0, 1, 0, 0]);
  });

  it("re-sends a frame when only the icons change, not just the LCD", async () => {
    const pet = new FakePet();
    await startHub(pet);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    ws.send(JSON.stringify({ t: "hello", token, petId: "pet-1" }));
    await waitForMessage(ws, (m) => m.t === "frame");

    // LCD untouched; only an icon segment lights up. The change detector must
    // treat the icons as part of the frame state, or the row would freeze.
    pet.setIcon(7, 1);
    const frameP = waitForMessage(ws, (m) => m.t === "frame" && m.icons?.[7] === 1);
    hub.notifyChanged();
    const frame = await frameP;
    expect(frame.icons[7]).toBe(1);
    expect(frame.lcd.every((b: number) => b === 0)).toBe(true);
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

  it("emits state{alive:false} when a pet dies, not only on bind (Task-6 Finding B)", async () => {
    const pet = new FakePet();
    await startHub(pet);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    ws.send(JSON.stringify({ t: "hello", token, petId: "pet-1" }));
    // The bind-time state says the pet is alive.
    const initial = await waitForMessage(ws, (m) => m.t === "state");
    expect(initial.alive).toBe(true);

    // The pet dies: the next notifyChanged must push state{alive:false}.
    pet.alive = false;
    const deadState = waitForMessage(ws, (m) => m.t === "state" && m.alive === false);
    hub.notifyChanged(() => pet.alive);
    const msg = await deadState;
    expect(msg).toMatchObject({ t: "state", alive: false });
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
    expect(hub.hasLiveConnection("uuid-user-1")).toBe(true);
    ws.close();
    await new Promise<void>((r) => ws.on("close", () => r()));
    expect(hub.hasLiveConnection("uuid-user-1")).toBe(false);
  });

  it("tolerates a pet whose icons() throws or is absent, still sending the LCD", async () => {
    // A pet that predates the icons() addition must not break frame streaming.
    const pet = new FakePet();
    // @ts-expect-error simulate a legacy LivePet without icons()
    delete pet.icons;
    await startHub(pet);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    const frameP = waitForMessage(ws, (m) => m.t === "frame");
    ws.send(JSON.stringify({ t: "hello", token, petId: "pet-1" }));
    const frame = await frameP;
    expect(frame.lcd).toHaveLength(512);
    expect(frame.icons).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
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
