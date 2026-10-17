import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { WsHub } from "../server/src/ws";
import { verifyIdToken, resetJwksCache, type TokenClaims } from "../server/src/auth";
import { makeTestKey, signJwt, jwksFetch, type TestKey } from "./helpers/jwt";

// Fast buzzer sampler: the piezo level must reach watching sockets at a cadence
// far finer than the 125 ms LCD tick, because a measured chirp burst can be as
// short as 50 ms (docs/BEEPS.md) and the tick sampler misses ~25 % of them
// (measured on the real ROM: 27/36 bursts detected, avg latency 57 ms, max
// 125 ms). The sampler is **state-read only** — it must never take an emulator
// step (that would mint game time and re-introduce the time exploit, see
// docs/DECISIONS.md "Zeit-Exploit").

const CLIENT = "1234.apps.googleusercontent.com";
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

/** Minimal pet stub with a call-counted `step()` and a live buzzer level. */
class FakePet {
  lcdBuf = new Uint8Array(512);
  iconBuf = new Uint8Array(8);
  alive = true;
  buzzerState: { freq: number; on: boolean } = { freq: 0, on: false };
  /** Every `step(ms)` call, so a test can prove the sampler takes no time. */
  steps: number[] = [];
  lcd(): Uint8Array {
    return this.lcdBuf;
  }
  icons(): Uint8Array {
    return this.iconBuf;
  }
  buzzer(): { freq: number; on: boolean } {
    return this.buzzerState;
  }
  step(ms: number): void {
    this.steps.push(ms);
  }
  press(): void {}
  dead(): boolean {
    return !this.alive;
  }
}

function loadPet(pet: FakePet) {
  return async (sub: string, petId: string): Promise<{ pet: FakePet; alive: boolean; ageYears: number; userId: string }> => {
    if (sub !== "user-1" || petId !== "pet-1") throw new Error("unknown pet");
    return { pet, alive: true, ageYears: 2, userId: "uuid-user-1" };
  };
}

function verifyWith(key: TestKey) {
  return (token: string, clientId: string): Promise<TokenClaims> =>
    verifyIdToken(token, clientId, { fetchImpl: jwksFetch(key.jwk), now: NOW });
}

/** Wait for a message matching `pred`, or reject after `timeoutMs`. */
function waitForMessage(ws: WebSocket, pred: (m: any) => boolean, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for message")), timeoutMs);
    const onMsg = (d: any): void => {
      let m: any;
      try {
        m = JSON.parse(String(d));
      } catch {
        return;
      }
      if (pred(m)) {
        clearTimeout(timer);
        ws.off("message", onMsg);
        resolve(m);
      }
    };
    ws.on("message", onMsg);
  });
}

/** Open a socket, send `hello`, and wait until the bind's first frame arrives. */
async function bindSocket(url: string, token: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((r) => ws.on("open", () => r()));
  ws.send(JSON.stringify({ t: "hello", token, petId: "pet-1" }));
  await waitForMessage(ws, (m) => m.t === "state");
  return ws;
}

let server: Server;
let wss: WsHub;
let url = "";
let key: TestKey;
let token = "";
let pet: FakePet;

beforeEach(async () => {
  resetJwksCache();
  key = await makeTestKey();
  token = await signJwt(key.priv, { sub: "user-1", aud: CLIENT, iss: "https://accounts.google.com", exp: Math.floor(NOW / 1000) + 3600 });
  pet = new FakePet();
  wss = new WsHub({ verify: verifyWith(key), loadPet: loadPet(pet), clientId: CLIENT });
  server = createServer();
  wss.attach(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  url = `ws://127.0.0.1:${(server.address() as { port: number }).port}/ws`;
});

afterEach(async () => {
  await wss.close();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("WsHub fast buzzer sampler", () => {
  it("samples all bound pets' piezo level with no emulator step", async () => {
    const ws = await bindSocket(url, token);
    const before = pet.steps.length;
    // A fresh piezo state the tick sampler has not seen yet.
    pet.buzzerState = { freq: 23406, on: true };
    wss.sampleBuzzers();
    const m = await waitForMessage(ws, (x) => x.t === "buzzer");
    expect(m).toEqual({ t: "buzzer", freq: 23406, on: true });
    // State-read only: the fast sampler must take no emulator step at all.
    expect(pet.steps.length).toBe(before);
    ws.close();
  });

  it("emits a short chirp the slow tick sampler would have missed", async () => {
    const ws = await bindSocket(url, token);
    // A 20 ms chirp that never coincides with a 125 ms LCD tick boundary.
    pet.buzzerState = { freq: 27307, on: true };
    wss.sampleBuzzers();
    const on = await waitForMessage(ws, (x) => x.t === "buzzer" && x.on === true);
    expect(on).toEqual({ t: "buzzer", freq: 27307, on: true });
    // The chirp ends before the next tick: the off edge must also be streamed.
    pet.buzzerState = { freq: 27307, on: false };
    wss.sampleBuzzers();
    const off = await waitForMessage(ws, (x) => x.t === "buzzer" && x.on === false);
    expect(off).toEqual({ t: "buzzer", freq: 27307, on: false });
    ws.close();
  });

  it("re-articulates an identical repeated tone as a fresh on-edge", async () => {
    const ws = await bindSocket(url, token);
    const seen: Array<{ freq: number; on: boolean }> = [];
    ws.on("message", (d) => {
      const m = JSON.parse(String(d));
      if (m.t === "buzzer") seen.push({ freq: m.freq, on: m.on });
    });
    // Two identical chirps (same freq), each on→off. A diff-only sampler that
    // deduped on unchanged (freq,on) would swallow the second chirp's identity;
    // here the on-edge after an off must always be streamed.
    pet.buzzerState = { freq: 23406, on: true };
    wss.sampleBuzzers();
    pet.buzzerState = { freq: 23406, on: false };
    wss.sampleBuzzers();
    pet.buzzerState = { freq: 23406, on: true };
    wss.sampleBuzzers();
    pet.buzzerState = { freq: 23406, on: false };
    wss.sampleBuzzers();
    await waitForMessage(ws, () => seen.length >= 4);
    expect(seen).toEqual([
      { freq: 23406, on: true },
      { freq: 23406, on: false },
      { freq: 23406, on: true },
      { freq: 23406, on: false },
    ]);
    ws.close();
  });

  it("still dedups an unchanged level between samples", async () => {
    const ws = await bindSocket(url, token);
    pet.buzzerState = { freq: 23406, on: true };
    wss.sampleBuzzers();
    await waitForMessage(ws, (x) => x.t === "buzzer");
    // Re-sampling the identical level must not emit another message.
    let count = 0;
    ws.on("message", (d) => {
      if (JSON.parse(String(d)).t === "buzzer") count++;
    });
    wss.sampleBuzzers();
    wss.sampleBuzzers();
    await new Promise((r) => setTimeout(r, 100));
    expect(count).toBe(0);
    ws.close();
  });

  it("does not sample or emit for a pet without buzzer()", async () => {
    // @ts-expect-error legacy pet: no buzzer()
    delete pet.buzzer;
    const ws = await bindSocket(url, token);
    let sawBuzzer = false;
    ws.on("message", (d) => {
      if (JSON.parse(String(d)).t === "buzzer") sawBuzzer = true;
    });
    wss.sampleBuzzers();
    await new Promise((r) => setTimeout(r, 100));
    expect(sawBuzzer).toBe(false);
    ws.close();
  });

  it("swallows a throwing buzzer() without crashing the sampler", async () => {
    pet.buzzer = () => {
      throw new Error("boom");
    };
    const ws = await bindSocket(url, token);
    expect(() => wss.sampleBuzzers()).not.toThrow();
    ws.close();
  });

  it("ignores sockets that never completed hello", async () => {
    // A raw socket that connects but never authenticates must not be sampled.
    const raw = new WebSocket(url);
    await new Promise<void>((r) => raw.on("open", () => r()));
    pet.buzzerState = { freq: 23406, on: true };
    expect(() => wss.sampleBuzzers()).not.toThrow();
    let got = false;
    raw.on("message", (d) => {
      if (JSON.parse(String(d)).t === "buzzer") got = true;
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toBe(false);
    raw.close();
  });
});

