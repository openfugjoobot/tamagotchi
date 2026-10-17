/**
 * Live WebSocket channel: LCD frames out, button presses in.
 *
 * One hub serves every connection. The flow is deliberately three-step so a
 * socket is never trusted before it proves who it is:
 *
 *   1. connect  — the socket is accepted but carries no identity and no pet.
 *   2. `hello`  — `{t:"hello", token, petId}`. The token is verified (Google
 *                 JWKS, same code path as the HTTP API); the pet is loaded and
 *                 checked to belong to that user. Only then is the socket bound
 *                 to a `(userId, petId)` pair and registered as "live".
 *   3. streaming — the hub pushes `{t:"frame", lcd}` whenever the pet's LCD
 *                 changed, plus an optional `{t:"frame", lcd, icons}` when
 *                 icon segments also changed,
 *                 `{t:"buzzer", freq, on}` whenever the pet's piezo state
 *                 changed (so a watching tab can drive its local audio — the
 *                 browser no longer runs the emulator, only renders its output),
 *                 and `{t:"state", alive, ageYears}` on bind *and* whenever the
 *                 life-state (alive) flips — so a pet dying with the tab open
 *                 emits `state{alive:false}` (Task-6 Finding B). The `lcd`
 *                 field is the 512-bit monochrome frame **bit-packed and
 *                 base64-encoded** (64 bytes → 88 chars; see
 *                 src/net/lcd-codec.ts) instead of a 512-number JSON array.
 *                 The optional `icons` field carries the 8 P1 menu/status LCD
 *                 segments bit-packed into one base64 byte (see
 *                 docs/DECISIONS.md) so the client can draw the top/bottom icon
 *                 rows from real state rather than a hardcoded blank. It is
 *                 **omitted while all 8 bits are zero** (the state the shipped
 *                 P1 ROM leaves them in), so an all-dim row costs nothing on the
 *                 wire. A pet without `icons()` (legacy stub) degrades to an
 *                 all-zero row, exactly as if the field were absent.
 *                 Similarly a legacy `LivePet` without `buzzer()` degrades to
 *                 "always silent": no buzzer message is ever streamed.
 *                 `{t:"press", btn}` from the client is forwarded to the bound
 *                 pet.
 *
 * `hasLiveConnection(userId)` is the push gate (spec §4): if the user is
 * watching, they already see and hear the beep, so no system notification is
 * sent. It reads the per-user connection set, which is emptied the moment a
 * socket closes, so the gate can never stay stuck open.
 *
 * Dependencies are injected (`verify`, `loadPet`, the pet-change source) so the
 * protocol runs in tests without Postgres, Google, or WASM.
 */
import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import { WebSocketServer, WebSocket } from "ws";
import { verifyIdToken, type TokenClaims } from "./auth.js";
import { encodeLcd, encodeIcons, iconsAreZero } from "../../src/net/lcd-codec.js";

export type Btn = "left" | "middle" | "right";
const BTNS: readonly Btn[] = ["left", "middle", "right"];

/** What a bound socket can do with its pet. Satisfied by `PetEmulator`. */
export interface LivePet {
  lcd(): Uint8Array;
  /**
   * The 8 icon-segment bits (0/1), or `undefined`/absent for a legacy stub.
   * Optional so the hub can stream a pet that predates the icon extension.
   */
  icons?(): Uint8Array;
  /**
   * Current piezo state: `freq` (raw HAL-glue value, no rescaling) and the
   * enable flag. Optional so a pet predating the buzzer extension simply streams
   * no audio instead of breaking the frame/state path.
   */
  buzzer?(): { freq: number; on: boolean };
  /**
   * Feed a button event. `down === undefined` is a legacy self-contained tap;
   * explicit `true`/`false` assert/release a button, and any combination may be
   * held at once (A+C = sound toggle). A legacy pet that only understands a
   * single-argument tap still works: the hub drops the `down` flag for it.
   */
  press(btn: Btn, down?: boolean): void;
}

/** Number of icon segments carried per frame (P1: 8). */
export const ICON_COUNT = 8;

/** Pet plus life-state resolved for a `hello`. */
export interface LoadedPet {
  pet: LivePet;
  alive: boolean;
  ageYears: number;
  /**
   * Our internal `users.id` for the authenticated caller — NOT the Google
   * `sub` the token carried. The push gate is keyed by this id (the sweeper
   * looks up beeps' owner as `pets.user_id`), so binding by the raw `sub` would
   * leave the gate permanently open and push a notification even to a watching
   * user. The loader resolves it (Task-13 e2e fix).
   */
  userId: string;
}

export interface WsHubDeps {
  /** Verify a Google ID token. Defaults to the real JWKS verifier. */
  verify?: (token: string, clientId: string) => Promise<TokenClaims>;
  /**
   * Resolve the pet named in `hello`, scoped to the authenticated user. The
   * first argument is the token's Google `sub`; the returned `userId` is our
   * internal `users.id` (the push-gate key).
   */
  loadPet: (sub: string, petId: string) => Promise<LoadedPet>;
  /** Google client id used as the token audience. */
  clientId: string;
}

/** Per-socket binding, set only after a successful `hello`. */
interface Binding {
  userId: string;
  petId: string;
  pet: LivePet;
  alive: boolean;
  ageYears: number;
  /** Last LCD sent, so we only emit on change. */
  lastLcd: Uint8Array | null;
  /** Last icon-segment state sent, so an icon-only change also emits. */
  lastIcons: Uint8Array | null;
  /** Whether the last frame carried an `icons` field (false while all-zero). */
  lastIconsOnWire: boolean;
  /** Last piezo state sent, so a buzzer change emits exactly once. */
  lastBuzzer: { freq: number; on: boolean } | null;
}

export class WsHub {
  private wss: WebSocketServer | null = null;
  private readonly verify: (token: string, clientId: string) => Promise<TokenClaims>;
  private readonly loadPet: (userId: string, petId: string) => Promise<LoadedPet>;
  private readonly clientId: string;
  /** Live sockets per user — the push gate (spec §4). */
  private readonly byUser = new Map<string, Set<WebSocket>>();
  private readonly bindings = new WeakMap<WebSocket, Binding>();

  constructor(deps: WsHubDeps) {
    this.verify = deps.verify ?? verifyIdToken;
    this.loadPet = deps.loadPet;
    this.clientId = deps.clientId;
  }

  /** Attach to an existing HTTP(S) server, handling upgrades on `/ws`. */
  attach(server: HttpServer | HttpsServer): void {
    if (this.wss) throw new Error("WsHub already attached");
    const wss = new WebSocketServer({ noServer: true });
    this.wss = wss;

    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    });

    wss.on("connection", (ws) => {
      ws.on("message", (data) => void this.onMessage(ws, data));
      ws.on("close", () => this.forget(ws));
      ws.on("error", () => this.forget(ws));
    });
  }

  /** True while at least one authenticated socket watches this user's pet. */
  hasLiveConnection(userId: string): boolean {
    const set = this.byUser.get(userId);
    return set !== undefined && set.size > 0;
  }

  /** Close the server and every live socket. Idempotent. */
  async close(): Promise<void> {
    const wss = this.wss;
    if (!wss) return;
    this.wss = null;
    for (const client of wss.clients) client.terminate();
    this.byUser.clear();
    await new Promise<void>((r) => wss.close(() => r()));
  }

  /**
   * Sample every bound pet's piezo **level** and push a `buzzer` message on
   * change, at whatever cadence the caller runs it.
   *
   * This exists because the LCD tick (125 ms, 8 fps) is far too coarse for the
   * piezo: a measured chirp burst can be as short as 50 ms (docs/BEEPS.md), and
   * the 125 ms sampler misses ~25 % of bursts (measured on the real ROM: 27/36
   * bursts detected, avg latency 57 ms, max 125 ms). A dedicated fast sampler
   * (see `main.ts`, `BUZZER_SAMPLE_MS`) closes that gap: 100 % of bursts land
   * and the tone reaches the browser within one sample interval.
   *
   * **State-read only:** it reads `pet.buzzer()` (a level, not the consumed
   * latch) and never takes an emulator step, so it grants **zero** emulated
   * time — the time invariant (a button press never mints game time, and the
   * clock follows only the wall clock) is untouched. See docs/DECISIONS.md.
   *
   * It is split out from `notifyChanged` so `notifyChanged` can stay the coarse
   * LCD/state tick while the buzzer is sampled independently and much faster.
   * `notifyChanged` still calls it, so a caller that only drives ticks keeps the
   * previous behaviour (buzzer on tick); the fast sampler calls it too, and the
   * level-diff in `pushBuzzer` makes the overlap idempotent (a state already
   * streamed this tick is not re-sent).
   */
  sampleBuzzers(): void {
    for (const client of this.wss?.clients ?? []) {
      const binding = this.bindings.get(client);
      if (!binding) continue;
      this.pushBuzzer(client, binding);
    }
  }

  /**
   * Signal that a pet's LCD or buzzer may have changed. Call after each tick:
   * every bound socket whose pet changed receives a fresh `frame`, a `buzzer`
   * whenever the pet's piezo state flipped since the last emission, and a
   * `state` whenever the pet's life-state flipped. Frames and buzzers are only
   * sent on actual change, so an idle pet costs nothing.
   *
   * `alive` is supplied by the caller (the entrypoint reads `pet.dead()`): the
   * hub itself cannot inspect a `LivePet` for death, so the tick loop passes the
   * freshly-determined flag. Omitting it keeps the previously-known state.
   */
  notifyChanged(alive?: (petId: string) => boolean): void {
    for (const client of this.wss?.clients ?? []) {
      const binding = this.bindings.get(client);
      if (!binding) continue;
      if (alive) {
        const nowAlive = alive(binding.petId);
        if (nowAlive !== binding.alive) {
          binding.alive = nowAlive;
          this.send(client, { t: "state", alive: binding.alive, ageYears: binding.ageYears });
        }
      }
      this.pushBuzzer(client, binding);
      this.pushFrame(client, binding);
    }
  }

  private async onMessage(ws: WebSocket, data: unknown): Promise<void> {
    let msg: { t?: unknown; token?: unknown; petId?: unknown; btn?: unknown; down?: unknown };
    try {
      msg = JSON.parse(String(data));
    } catch {
      return; // ignore garbage
    }

    if (msg.t === "hello") return this.onHello(ws, msg.token, msg.petId);
    // A self-contained tap (legacy) or an explicit down/up edge; both are
    // forwarded to the same pet entry point.
    if (msg.t === "press") return this.onPress(ws, msg.btn, undefined);
    if (msg.t === "btn") return this.onPress(ws, msg.btn, msg.down);
  }

  /** Authenticate, bind to the pet, send the first frame and the state. */
  private async onHello(ws: WebSocket, token: unknown, petId: unknown): Promise<void> {
    if (typeof token !== "string" || typeof petId !== "string") {
      ws.close(4400, "hello requires token and petId");
      return;
    }
    let sub: string;
    try {
      const claims = await this.verify(token, this.clientId);
      sub = claims.sub;
    } catch {
      ws.close(4401, "unauthenticated");
      return;
    }

    let loaded: LoadedPet;
    try {
      // The loader takes the token's `sub` and resolves it to our internal
      // users.id; that resolved id is what the push gate keys on.
      loaded = await this.loadPet(sub, petId);
    } catch {
      ws.close(4404, "unknown pet");
      return;
    }

    const binding: Binding = {
      userId: loaded.userId,
      petId,
      pet: loaded.pet,
      alive: loaded.alive,
      ageYears: loaded.ageYears,
      lastLcd: null,
      lastIcons: null,
      lastIconsOnWire: false,
      lastBuzzer: null,
    };
    this.bindings.set(ws, binding);
    this.addLive(loaded.userId, ws);

    this.send(ws, { t: "state", alive: binding.alive, ageYears: binding.ageYears });
    this.pushFrame(ws, binding);
    this.pushBuzzer(ws, binding);
  }

  /** Forward a button press to the bound pet. Ignored before `hello`. */
  /**
   * Forward a button event to the bound pet. Ignored before `hello`.
   *
   * `down === undefined` is a legacy self-contained tap (`{t:"press"}`). A
   * boolean is an explicit edge (`{t:"btn"}`): `true` asserts, `false` releases.
   * Both are passed straight through; a legacy `LivePet` that only reads the
   * button name simply ignores the extra argument, so the channel never breaks.
   */
  private onPress(ws: WebSocket, btn: unknown, down: unknown): void {
    const binding = this.bindings.get(ws);
    if (!binding) return;
    if (typeof btn !== "string" || !BTNS.includes(btn as Btn)) return;
    if (typeof down === "boolean") binding.pet.press(btn as Btn, down);
    else binding.pet.press(btn as Btn);
  }

  /**
   * Emit a frame only when the LCD **or** the icon segments differ from the last
   * one sent. The icons are read defensively: a legacy `LivePet` without
   * `icons()` (or one that throws) degrades to an all-zero row instead of
   * breaking the frame stream.
   *
   * The wire form is compact: `lcd` is the 512-bit frame bit-packed and
   * base64-encoded (64 bytes → 88 chars), and `icons` is the same treatment for
   * the 8 segments (1 byte). The `icons` field is **omitted while all 8 bits are
   * zero** — the state the shipped P1 ROM leaves them in — so an unlit icon row
   * costs nothing; it appears only on the frames that actually light a segment.
   */
  private pushFrame(ws: WebSocket, binding: Binding): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const lcd = binding.pet.lcd();
    const icons = readIcons(binding.pet);
    if (
      binding.lastLcd &&
      binding.lastIcons &&
      buffersEqual(binding.lastLcd, lcd) &&
      buffersEqual(binding.lastIcons, icons) &&
      binding.lastIconsOnWire === !iconsAreZero(icons)
    ) {
      return;
    }
    binding.lastLcd = new Uint8Array(lcd); // copy: WASM memory can move
    binding.lastIcons = icons;
    const sendIcons = !iconsAreZero(icons);
    binding.lastIconsOnWire = sendIcons;
    const msg: Record<string, unknown> = { t: "frame", lcd: encodeLcd(binding.lastLcd) };
    if (sendIcons) msg.icons = encodeIcons(binding.lastIcons);
    this.send(ws, msg);
  }

  /**
   * Emit the piezo state only when it differs from the last one sent. The read
   * is defensive: a legacy `LivePet` without `buzzer()` (or one that throws)
   * yields no message at all, so the frame/state path is unaffected. The values
   * are streamed verbatim; the client owns the unit conversion, exactly like the
   * in-browser emulator did.
   */
  private pushBuzzer(ws: WebSocket, binding: Binding): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const b = readBuzzer(binding.pet);
    if (b === null) return; // legacy pet: no buzzer signal at all
    const last = binding.lastBuzzer;
    if (last && last.freq === b.freq && last.on === b.on) return;
    binding.lastBuzzer = b;
    this.send(ws, { t: "buzzer", freq: b.freq, on: b.on });
  }

  private addLive(userId: string, ws: WebSocket): void {
    let set = this.byUser.get(userId);
    if (!set) {
      set = new Set();
      this.byUser.set(userId, set);
    }
    set.add(ws);
  }

  /** Drop a socket from the live map so the push gate closes again. */
  private forget(ws: WebSocket): void {
    const binding = this.bindings.get(ws);
    if (!binding) return;
    const set = this.byUser.get(binding.userId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) this.byUser.delete(binding.userId);
    }
  }

  private send(ws: WebSocket, msg: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
}

function buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Read the pet's piezo state, or `null` for a pet that has no `buzzer()` (or
 * whose `buzzer()` throws). Never throws: the buzzer path must stay optional so
 * a pet predating it still streams frames. `freq` is coerced to a finite
 * non-negative integer (a NaN/garbage export must not reach the wire).
 */
function readBuzzer(pet: LivePet): { freq: number; on: boolean } | null {
  if (typeof pet.buzzer !== "function") return null;
  try {
    const b = pet.buzzer();
    const freq = Number.isFinite(b.freq) ? Math.max(0, Math.floor(b.freq)) : 0;
    return { freq, on: b.on === true };
  } catch {
    return null;
  }
}

/**
 * Read the pet's icon bits as a fresh 8-length 0/1 buffer. Never throws: a
 * missing `icons()` or a throwing one yields all-zero, so the frame path stays
 * total (the old hub streamed LCD-only for exactly this reason) — and an
 * all-zero buffer is not even put on the wire (see `pushFrame`).
 */
function readIcons(pet: LivePet): Uint8Array {
  const out = new Uint8Array(ICON_COUNT);
  if (typeof pet.icons !== "function") return out;
  try {
    const src = pet.icons();
    const n = Math.min(ICON_COUNT, src.length);
    for (let i = 0; i < n; i++) out[i] = src[i] ? 1 : 0;
  } catch {
    return new Uint8Array(ICON_COUNT);
  }
  return out;
}
