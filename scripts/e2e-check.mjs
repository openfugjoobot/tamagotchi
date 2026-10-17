// End-to-end check driver (Task 13, Step 2).
//
// Boots the REAL server wiring (`startServer` + real `Repo` + real Postgres +
// real `PetEmulator` with the real P1 ROM/WASM) and drives it over real HTTP and
// a real WebSocket, exactly as production does. Only two things are injected,
// both because they hit external services the check must not depend on:
//   * `verify`  — a self-signed JWKS (the repo's own tests do the same; Google
//                 itself is not reachable from here),
//   * `sender`  — a recording stub, so we can prove a *push attempt* happened
//                 without talking to a real push service.
//
// Flow: create a pet over the API → connect a WS client → `hello` → set the
// clock (advance real time) → observe LCD frames → wait for a beep → confirm a
// `beeps` row and a push attempt.

import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { WebSocket } from "ws";
import { startServer } from "../dist-server/server/src/main.js";
import { verifyIdToken } from "../dist-server/server/src/auth.js";

const DB_URL = process.env.DATABASE_URL;
const CLIENT = "1234.apps.googleusercontent.com";
const KID = "e2e";

const log = (...a) => console.log("[e2e]", ...a);

function b64u(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return Buffer.from(bin, "binary").toString("base64url");
}

async function makeKeyAndJwks() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const sign = async (payload) => {
    const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID }));
    const body = b64u(JSON.stringify(payload));
    const sig = new Uint8Array(
      await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${header}.${body}`)),
    );
    return `${header}.${body}.${b64u(sig)}`;
  };
  const fetchImpl = async () =>
    new Response(JSON.stringify({ keys: [{ ...jwk, kid: KID }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  return { sign, fetchImpl };
}

async function main() {
  const { sign, fetchImpl } = await makeKeyAndJwks();
  const token = await sign({
    sub: "e2e-user-1",
    aud: CLIENT,
    iss: "https://accounts.google.com",
    email: "e2e@example.com",
    name: "E2E",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  // Recording push sender — proves the *attempt*, no network.
  const attempts = [];
  const sender = {
    async send(sub, payload) {
      attempts.push({ endpoint: sub.endpoint, ...payload });
      log("push attempt →", sub.endpoint, JSON.stringify(payload));
    },
  };

  const pool = new Pool({ connectionString: DB_URL });
  const srv = await startServer({
    pool,
    clientId: CLIENT,
    vapid: { subject: "mailto:e2e@example.com", publicKey: "pub", privateKey: "priv" },
    verify: (t, clientId) => verifyIdToken(t, clientId, { fetchImpl }),
    sender,
    pushIntervalMs: 700,
    loadRom: (device) => new Uint8Array(readFileSync(`public/emu/rom${device === "p2" ? "2" : "0"}.bin`)),
    loadWasm: () => new Uint8Array(readFileSync("public/emu/tamalib.wasm")),
  });
  log("server up:", srv.url, "ws:", srv.wsUrl + "/ws");

  try {
    // 1. create a pet over the real API.
    const created = await fetch(`${srv.url}/api/pets`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ device: "p1" }),
    });
    const pet = await created.json();
    log("POST /api/pets →", created.status, JSON.stringify(pet));
    if (created.status !== 201) throw new Error("pet creation failed");

    // Register a push subscription so the sweeper has somewhere to send.
    await fetch(`${srv.url}/api/push/subscribe`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ endpoint: "https://push.example/e2e-1", p256dh: "k", auth: "a" }),
    });

    // The API starts the live emulator asynchronously; wait until it is live so
    // `hello` can bind (a not-yet-live pet answers 4404 `unknown pet`).
    for (let i = 0; i < 50 && !srv.livePetIds().includes(pet.id); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!srv.livePetIds().includes(pet.id)) throw new Error("pet never became live");
    log("pet live in the tick loop:", pet.id);

    // 2. connect a WS client and send `hello`.
    const ws = new WebSocket(`${srv.wsUrl}/ws`);
    let frames = 0;
    let distinct = 0;
    let lastLcd = null;
    let sawState = null;
    await new Promise((resolve, reject) => {
      ws.on("open", () => {
        ws.send(JSON.stringify({ t: "hello", token, petId: pet.id }));
        resolve();
      });
      ws.on("error", reject);
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data));
      if (msg.t === "frame") {
        frames++;
        const k = msg.lcd.join("");
        if (k !== lastLcd) { lastLcd = k; distinct++; }
      } else if (msg.t === "state") sawState = msg;
    });
    ws.on("close", (code, reason) => log("WS closed:", code, reason.toString()));
    ws.on("error", (e) => log("WS error:", e.message));
    await new Promise((r) => setTimeout(r, 800));
    const { rows: uidRows } = await pool.query(`select id from users where google_sub=$1`, ["e2e-user-1"]);
    const internalId = uidRows[0].id;
    log("hello ack → bound:", frames > 0, "| push gate open (hasLiveConnection):", srv.hub.hasLiveConnection(internalId), "| state:", JSON.stringify(sawState));

    // 3. set the clock: press A (the ROM's setup prompt needs a button), which
    //    also proves button input flows through the socket.
    ws.send(JSON.stringify({ t: "press", btn: "left" }));

    // 4. let it run and wait for the first beep row (the real tick loop drives
    //    the emulator in real time).
    const userId = internalId;
    const deadline = Date.now() + 120_000;
    let beepRow = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      const { rows } = await pool.query(
        `select b.id, b.pet_id, b.at, b.notified_at
           from beeps b join pets p on p.id = b.pet_id
          where p.user_id = $1 order by b.at asc`,
        [userId],
      );
      if (rows.length > 0) { beepRow = rows[0]; break; }
      log(`… waiting for a beep (frames=${frames}, distinct=${distinct}, t+${Math.round((Date.now() - (deadline - 120_000)) / 1000)}s)`);
    }

    log("WS frames:", frames, "distinct:", distinct);
    log("beeps row:", JSON.stringify(beepRow));

    // 5. push gate: while we are watching, the sweeper must stay quiet.
    await new Promise((r) => setTimeout(r, 2500));
    const { rows: whileLive } = await pool.query(`select notified_at from beeps where id = $1`, [
      beepRow ? beepRow.id : "00000000-0000-0000-0000-000000000000",
    ]);
    log("[gate] push attempts while watching:", attempts.length, "| notified_at:", whileLive[0] ? whileLive[0].notified_at : null);
    const gateHeld = attempts.length === 0;

    // 6. now close the socket (the user stops watching) and let the sweeper run:
    //    the still-pending beep must be pushed.
    await new Promise((r) => { ws.on("close", () => r()); ws.close(); });
    const pushDeadline = Date.now() + 10_000;
    while (attempts.length === 0 && Date.now() < pushDeadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
    const { rows: after } = await pool.query(`select notified_at from beeps where id = $1`, [
      beepRow ? beepRow.id : "00000000-0000-0000-0000-000000000000",
    ]);
    log("push attempts after stop watching:", attempts.length, "| beep notified_at:", after[0] ? after[0].notified_at : null);

    const ok =
      created.status === 201 && frames > 0 && beepRow !== null && gateHeld && attempts.length > 0 && after[0] && after[0].notified_at !== null;
    log("RESULT:", ok ? "PASS" : "INCOMPLETE");
    await srv.close();
    await pool.end();
    process.exit(ok ? 0 : 2);
  } catch (err) {
    log("ERROR:", err && err.message ? err.message : err);
    await srv.close().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

main();
