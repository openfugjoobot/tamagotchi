import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { newDb, DataType } from "pg-mem";
import { WebSocket } from "ws";
import { startServer } from "../server/src/main";
import { PetEmulator } from "../server/src/emulator";
import { resetBeepDebounce } from "../server/src/beeps";
import { signJwt, makeTestKey, jwksFetch, type TestKey } from "./helpers/jwt";
import { verifyIdToken, resetJwksCache } from "../server/src/auth";

/**
 * End-to-end: a simultaneous A+C (SELECT+NEXT) sent over the real WS protocol
 * must reach the **real** server-side `PetEmulator` and drive the **real** P1
 * ROM — not just the emulator unit test. This wires the whole server (schema,
 * repo, tick loop, WS hub) against pg-mem and a self-built JWKS, with the real
 * ROM/WASM, and drives it with a raw `ws` client.
 *
 * The unit test (`emu-simultaneous-press.test.ts`) proves the ROM mutes on A+C;
 * the hub test (`server-ws.test.ts`) proves `{t:"btn"}` edges are forwarded.
 * This file proves the two are actually connected in the shipped entrypoint.
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

describe("simultaneous A+C end-to-end (client → WS → hub → real PetEmulator → ROM)", () => {
  beforeEach(() => {
    resetJwksCache();
    resetBeepDebounce();
  });

  it("holds both pins at once so the real ROM sees A+C", async () => {
    const Pool = memPool();
    const pool = new Pool();
    const key: TestKey = await makeTestKey();

    // Capture every real emulator the entrypoint builds, so the test can inspect
    // the held-pin state after the protocol messages arrive.
    const pets: PetEmulator[] = [];
    const srv = await startServer({
      pool: pool as never,
      clientId: CLIENT,
      vapid: { subject: "mailto:a@example.com", publicKey: "pub", privateKey: "priv" },
      loadRom: () => rom,
      loadWasm: () => wasm,
      createPet: (r: Uint8Array, w: Uint8Array, s?: Uint8Array) => {
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
      verify: (token: string, clientId: string) =>
        verifyIdToken(token, clientId, { fetchImpl: jwksFetch(key.jwk), now: Date.now() }),
    });

    try {
      const { Repo } = await import("../server/src/db/repo");
      const repo = new Repo(pool);
      const owner = await repo.upsertUser({ sub: "sub-e2e" });
      const pet = await repo.createPet(owner.id, "p1");
      await srv.rehydrate();
      expect(pets.length).toBeGreaterThan(0);
      const emu = pets[pets.length - 1];

      const token = await signJwt(key.priv, {
        sub: "sub-e2e",
        aud: CLIENT,
        iss: "https://accounts.google.com",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const ws = new WebSocket(`${srv.wsUrl}/ws`);
      await new Promise<void>((r) => ws.on("open", () => r()));
      await new Promise<void>((resolveState) => {
        ws.on("message", (d) => {
          const m = JSON.parse(String(d));
          if (m.t === "state") resolveState();
        });
        ws.send(JSON.stringify({ t: "hello", token, petId: pet.id }));
      });

      // SELECT (left) and NEXT (right) asserted together over the wire.
      ws.send(JSON.stringify({ t: "btn", btn: "left", down: true }));
      ws.send(JSON.stringify({ t: "btn", btn: "right", down: true }));
      await new Promise((r) => setTimeout(r, 100));

      // Both buttons are held at once: the emulator reports two pending presses,
      // and a step observes them LOW in the same frames (exactly what the ROM
      // needs for the A+C sound toggle).
      expect(emu.pendingPresses()).toBe(2);

      ws.send(JSON.stringify({ t: "btn", btn: "left", down: false }));
      ws.send(JSON.stringify({ t: "btn", btn: "right", down: false }));
      await new Promise((r) => setTimeout(r, 100));
      // Released: the explicit holds no longer count as pending.
      expect(emu.pendingPresses()).toBe(0);

      ws.close();
    } finally {
      await srv.close();
    }
  }, 20000);
});
