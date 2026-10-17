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
 *   3. streaming — the hub pushes `{t:"frame", lcd, icons}` whenever the pet's
 *                 LCD **or** its 8 icon segments changed, and
 *                 `{t:"state", alive, ageYears}` on bind *and* whenever the
 *                 life-state (alive) flips — so a pet dying with the tab open
 *                 emits `state{alive:false}` (Task-6 Finding B). The `icons`
 *                 array carries the 8 P1 menu/status LCD segments (see
 *                 docs/DECISIONS.md) so the client can draw the top/bottom icon
 *                 rows from real state rather than a hardcoded blank. A pet
 *                 without `icons()` (legacy stub) degrades to an all-zero row.
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
  press(btn: Btn): void;
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
   * Signal that a pet's LCD may have changed. Call after each tick: every bound
   * socket whose pet changed receives a fresh `frame`, and a `state` whenever
   * the pet's life-state flipped since the last emission. Frames are only sent
   * on actual change, so an idle pet costs nothing.
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
      this.pushFrame(client, binding);
    }
  }

  private async onMessage(ws: WebSocket, data: unknown): Promise<void> {
    let msg: { t?: unknown; token?: unknown; petId?: unknown; btn?: unknown };
    try {
      msg = JSON.parse(String(data));
    } catch {
      return; // ignore garbage
    }

    if (msg.t === "hello") return this.onHello(ws, msg.token, msg.petId);
    if (msg.t === "press") return this.onPress(ws, msg.btn);
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
    };
    this.bindings.set(ws, binding);
    this.addLive(loaded.userId, ws);

    this.send(ws, { t: "state", alive: binding.alive, ageYears: binding.ageYears });
    this.pushFrame(ws, binding);
  }

  /** Forward a button press to the bound pet. Ignored before `hello`. */
  private onPress(ws: WebSocket, btn: unknown): void {
    const binding = this.bindings.get(ws);
    if (!binding) return;
    if (typeof btn !== "string" || !BTNS.includes(btn as Btn)) return;
    binding.pet.press(btn as Btn);
  }

  /**
   * Emit a frame only when the LCD **or** the icon segments differ from the last
   * one sent. The icons are read defensively: a legacy `LivePet` without
   * `icons()` (or one that throws) degrades to an all-zero row instead of
   * breaking the frame stream.
   */
  private pushFrame(ws: WebSocket, binding: Binding): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const lcd = binding.pet.lcd();
    const icons = readIcons(binding.pet);
    if (
      binding.lastLcd &&
      binding.lastIcons &&
      buffersEqual(binding.lastLcd, lcd) &&
      buffersEqual(binding.lastIcons, icons)
    ) {
      return;
    }
    binding.lastLcd = new Uint8Array(lcd); // copy: WASM memory can move
    binding.lastIcons = icons;
    this.send(ws, {
      t: "frame",
      lcd: Array.from(binding.lastLcd),
      icons: Array.from(binding.lastIcons),
    });
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
 * Read the pet's icon bits as a fresh 8-length 0/1 array. Never throws: a
 * missing `icons()` or a throwing one yields all-zero, so the frame path stays
 * total (the old hub streamed LCD-only for exactly this reason).
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
