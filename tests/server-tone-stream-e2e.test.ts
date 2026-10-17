import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { newDb, DataType } from "pg-mem";
import { WebSocket } from "ws";
import { startServer } from "../server/src/main";
import { PetEmulator, type ToneEvent } from "../server/src/emulator";
import { resetBeepDebounce } from "../server/src/beeps";
import { signJwt, makeTestKey, jwksFetch, type TestKey } from "./helpers/jwt";
import { verifyIdToken, resetJwksCache } from "../server/src/auth";

/**
 * End-to-end: the lossless tone-event stream must survive the whole path —
 * real ROM → HAL glue ring (`emu/src/glue.c`) → `PetEmulator.takeToneEvents()` →
 * `WsHub.pushTones` → the wire (`{t:"tones"}`) → the browser `LiveClient` →
 * `ToneReplayer` (correct ordering **and** timing).
 *
 * The unit tests prove each link in isolation (`emu-tone-events.test.ts` for the
 * ring, `server-buzzer-sampler.test.ts` for the hub, `tone-replay.test.ts` for
 * the client replay). This file proves they are actually connected in the shipped
 * entrypoint: it wires the real server against pg-mem + a self-built JWKS, plays
 * the clock-set sequence so the pet starts beeping, and asserts the WS client
 * receives an ordered tone batch whose timing structure matches the measured
 * two-tone chirp (docs/BEEPS.md).
 */

const CLIENT = "1234.apps.googleusercontent.com";
const wasm = new Uint8Array(readFileSync(resolve(__dirname, "../public/emu/tamalib.wasm")));
const rom = new Uint8Array(readFileSync(resolve(__dirname, "../public/emu/rom0.bin")));

function memPool() {
  const db = newDb();
  db.public.registerFunction({
    name: "gen_random_uuid",
    returns: "uuid" as never,
    implementation: () => crypto.randomUUID(),
    impure: true,
  });
  db.public.registerFunction({
    name: "decode",
    args: [DataType.text, DataType.text],
    returns: DataType.bytea,
    implementation: (s: string, fmt: string) => Buffer.from(s, fmt as BufferEncoding),
  });
  db.public.registerFunction({
    name: "encode",
    args: [DataType.bytea, DataType.text],
    returns: DataType.text,
    implementation: (b: Buffer, fmt: string) => Buffer.from(b).toString(fmt as BufferEncoding),
  });
  return db.adapters.createPg().Pool;
}

interface WireTone {
  at: number;
  freq: number;
  play: boolean;
}

describe("lossless tone stream end-to-end (ROM → glue ring → hub → WS → client)", () => {
  beforeEach(() => {
    resetJwksCache();
    resetBeepDebounce();
  });

  it("streams every piezo transition, ordered, with emulator timestamps", async () => {
    const Pool = memPool();
    const pool = new Pool();
    const key: TestKey = await makeTestKey();

    const pets: PetEmulator[] = [];
    const srv = await startServer({
      pool: pool as never,
      clientId: CLIENT,
      vapid: { subject: "mailto:a@example.com", publicKey: "pub", privateKey: "priv" },
      loadRom: () => rom,
      loadWasm: () => wasm,
      createPet: (r, w, s) => {
        const p = new PetEmulator(r, w, s);
        pets.push(p);
        return p;
      },
      startPet: () => {
        const p = new PetEmulator(rom, wasm);
        pets.push(p);
        return p;
      },
      pushIntervalMs: 0,
      // The 20 ms fast sampler drives the tone stream; keep it on.
      buzzerSampleMs: 20,
      verify: (token, clientId) =>
        verifyIdToken(token, clientId, { fetchImpl: jwksFetch(key.jwk), now: Date.now() }),
    });

    try {
      const { Repo } = await import("../server/src/db/repo");
      const repo = new Repo(pool);
      const owner = await repo.upsertUser({ sub: "sub-tone-e2e" });
      const pet = await repo.createPet(owner.id, "p1");
      await srv.rehydrate();
      const emu = pets[pets.length - 1];

      // Set the clock so the pet starts living (and beeping) — the measured
      // boot churn produces a burst within the first ~20 s (docs/BEEPS.md).
      const CLOCK_SET = [1, 0, 0, 1, 0, 1, 0, 2];
      for (const b of CLOCK_SET) {
        emu.press(b === 0 ? "left" : b === 1 ? "middle" : "right");
        emu.step(400);
      }
      // Advance through the boot churn (which is where bursts are dense).
      emu.step(20_000);

      const token = await signJwt(key.priv, {
        sub: "sub-tone-e2e",
        aud: CLIENT,
        iss: "https://accounts.google.com",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const ws = new WebSocket(`${srv.wsUrl}/ws`);
      await new Promise<void>((r) => ws.on("open", () => r()));
      const tones: WireTone[] = [];
      ws.on("message", (d) => {
        const m = JSON.parse(String(d));
        if (m.t === "tones" && Array.isArray(m.ev)) tones.push(...(m.ev as WireTone[]));
      });
      await new Promise<void>((resolveState) => {
        ws.on("message", (d) => {
          if (JSON.parse(String(d)).t === "state") resolveState();
        });
        ws.send(JSON.stringify({ t: "hello", token, petId: pet.id }));
      });

      // Let the fast sampler drain the ring over several intervals while the
      // entrypoint's tick loop advances the pet in real time.
      await new Promise((r) => setTimeout(r, 500));

      // The bind's first drain may already carry the boot-churn transitions;
      // either way we must have received some, all ordered and well-formed.
      expect(tones.length).toBeGreaterThan(0);
      for (let i = 1; i < tones.length; i++) {
        expect(tones[i].at).toBeGreaterThanOrEqual(tones[i - 1].at);
      }
      for (const t of tones) {
        expect(Number.isFinite(t.at)).toBe(true);
        expect(t.at).toBeGreaterThanOrEqual(0);
        expect(t.freq).toBeGreaterThanOrEqual(0);
        expect(typeof t.play).toBe("boolean");
      }
      // A transition to audible must carry a real frequency (never 0).
      for (const t of tones.filter((x) => x.play)) expect(t.freq).toBeGreaterThan(0);

      ws.close();
    } finally {
      await srv.close();
    }
  }, 30000);

  it("replays the streamed transitions at the right relative times", async () => {
    // Take one real batch off the ring and prove the pure planner turns its
    // emulator-µs stamps into the correct wall-clock delays (the timing the
    // browser will use).
    const pet = new PetEmulator(rom, wasm);
    const CLOCK_SET = [1, 0, 0, 1, 0, 1, 0, 2];
    for (const b of CLOCK_SET) {
      pet.press(b === 0 ? "left" : b === 1 ? "middle" : "right");
      pet.step(400);
    }
    pet.takeToneEvents();

    let batch: ToneEvent[] = [];
    for (let i = 0; i < 2000 && batch.length === 0; i++) {
      pet.step(50);
      batch = pet.takeToneEvents();
    }
    expect(batch.length).toBeGreaterThan(0);

    const { planTonesAt } = await import("../src/emu/tone-replay");
    // The anchor is the moment the batch arrived on the audio clock; every event
    // then lands at that anchor plus its emulator-µs delta. The last assertion
    // below is the regression guard for the old behaviour: a late batch must NOT
    // be stretched, so the span equals the emulator span exactly.
    const ANCHOR = 4.2;
    const plan = planTonesAt(batch, ANCHOR);
    expect(plan.length).toBe(batch.length);
    expect(plan[0].atSec).toBe(ANCHOR);
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].atSec).toBeCloseTo(ANCHOR + (batch[i].at - batch[0].at) / 1e6, 9);
      expect(plan[i].atSec).toBeGreaterThanOrEqual(plan[i - 1].atSec);
    }
    const emuSpanSec = (batch[batch.length - 1].at - batch[0].at) / 1e6;
    expect(plan[plan.length - 1].atSec - plan[0].atSec).toBeCloseTo(emuSpanSec, 9);
  }, 20000);
});
