/**
 * Live WebSocket client — the browser's window onto a server-side pet.
 *
 * The in-tab emulator is gone: the pet runs on the server and this thin client
 * only relays. It speaks the Task-6 protocol:
 *
 *   →  {t:"hello", token, petId}   on (re)connect, to authenticate + bind
 *   ←  {t:"frame", lcd:string, icons?:string}  the 32×16 LCD plus (optionally)
 *                              the 8 icon-segment bits, both **bit-packed and
 *                              base64-encoded** (see net/lcd-codec.ts). The
 *                              `lcd` string is 64 bytes → 88 chars; `icons` is
 *                              one byte and is **omitted while all 8 segments
 *                              are zero** (the shipped P1 ROM leaves them there),
 *                              so a blank icon row costs nothing on the wire.
 *                              Drawn with render/lcd.ts and render/icons.ts.
 *   ←  {t:"buzzer", freq, on}  the pet's piezo state in the ROM's raw units;
 *                              consumed by emu/audio.ts on the frame loop
 *   ←  {t:"state", alive, ageYears}
 *   →  {t:"press", btn}            a self-contained button tap (legacy)
 *   →  {t:"btn", btn, down}       an explicit button edge: true asserts, false
 *                              releases; any combination held at once (A+C)
 *
 * Reconnection is automatic: any close/error schedules a retry with capped
 * exponential backoff, and each new socket re-sends `hello`. While the link is
 * down the pet keeps living on the server — the tab just doesn't show it.
 *
 * The transport is injectable (`WebSocketImpl`) so the protocol runs in tests
 * against a fake server, with no browser and no network.
 */

import { LCD_WIDTH, LCD_HEIGHT, ICON_COUNT, type Btn } from "../emu/constants";
import { decodeIcons, decodeLcd } from "./lcd-codec";

export type LiveStatus = "live" | "offline";

export interface LiveState {
  alive: boolean;
  ageYears: number;
}

/** Piezo state as carried on the wire: raw `freq` (0 = silent), `on` flag. */
export interface LiveBuzzer {
  freq: number;
  on: boolean;
}

export interface LiveClientOptions {
  /** WebSocket endpoint. Defaults to `/ws` on the current origin. */
  url?: string;
  /** Transport, injectable for tests. Defaults to the global WebSocket. */
  WebSocketImpl?: typeof WebSocket;
  /** First retry delay; doubles per attempt up to `maxReconnectDelayMs`. */
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

/** Default endpoint: same host as the app, `wss://` whenever the page is https. */
function defaultUrl(): string {
  const loc = typeof location !== "undefined" ? location : null;
  if (!loc) return "/ws";
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/ws`;
}

export class LiveClient {
  private readonly url: string;
  private readonly Impl: typeof WebSocket | undefined;
  private readonly baseDelay: number;
  private readonly maxDelay: number;

  private ws: WebSocket | null = null;
  private petId = "";
  private token = "";
  /** True between a user `connect()` and `disconnect()`. Blocks reconnect. */
  private active = false;
  /** True once this socket's `hello` has been sent (socket is streaming). */
  private bound = false;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly frameCbs = new Set<(lcd: Uint8Array, icons: Uint8Array) => void>();
  private readonly stateCbs = new Set<(s: LiveState) => void>();
  private readonly buzzerCbs = new Set<(b: LiveBuzzer) => void>();

  constructor(opts: LiveClientOptions = {}) {
    this.url = opts.url ?? defaultUrl();
    this.Impl = opts.WebSocketImpl ?? (typeof WebSocket !== "undefined" ? WebSocket : undefined);
    this.baseDelay = opts.reconnectDelayMs ?? 500;
    this.maxDelay = opts.maxReconnectDelayMs ?? 10_000;
  }

  /**
   * Begin (or restart) the stream for a pet. Safe to call again to switch pets:
   * any previous socket is dropped first.
   */
  connect(petId: string, token: string): void {
    this.petId = petId;
    this.token = token;
    this.active = true;
    this.retries = 0;
    // Drop a socket from a previous connect() before opening a fresh one.
    this.closeSocket();
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.open();
  }

  /**
   * Register a frame consumer. The callback gets the 32×16 LCD and the 8 icon
   * segments, each a fresh `Uint8Array`. Returns an unsubscribe function.
   */
  onFrame(cb: (lcd: Uint8Array, icons: Uint8Array) => void): () => void {
    this.frameCbs.add(cb);
    return () => this.frameCbs.delete(cb);
  }

  /** Register a life-state consumer. Returns an unsubscribe function. */
  onState(cb: (s: LiveState) => void): () => void {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }

  /**
   * Register a piezo-state consumer. The callback fires on bind and whenever the
   * pet's buzzer state changes (the server only sends on change). Returns an
   * unsubscribe function.
   */
  onBuzzer(cb: (b: LiveBuzzer) => void): () => void {
    this.buzzerCbs.add(cb);
    return () => this.buzzerCbs.delete(cb);
  }

  /** Send a button press. Ignored while not connected (nothing to press). */
  press(btn: Btn): void {
    if (!this.ws || this.ws.readyState !== 1 /* OPEN */) return;
    this.send({ t: "press", btn });
  }

  /**
   * Assert a button (down edge). Any combination may be asserted at once, so a
   * physical two-button press (SELECT+NEXT = A+C) reaches the ROM as genuine
   * simultaneity. Ignored while not connected.
   */
  pressDown(btn: Btn): void {
    if (!this.ws || this.ws.readyState !== 1 /* OPEN */) return;
    this.send({ t: "btn", btn, down: true });
  }

  /** Release a previously asserted button (up edge). Ignored while offline. */
  pressUp(btn: Btn): void {
    if (!this.ws || this.ws.readyState !== 1 /* OPEN */) return;
    this.send({ t: "btn", btn, down: false });
  }

  /** "live" once bound and streaming, otherwise "offline". */
  status(): LiveStatus {
    return this.bound ? "live" : "offline";
  }

  /** Stop for good: close the socket and cancel any pending reconnect. */
  disconnect(): void {
    this.active = false;
    this.bound = false;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.closeSocket();
  }

  /** Tear down the current socket without touching `active`/retry state. */
  private closeSocket(): void {
    const ws = this.ws;
    this.ws = null;
    this.bound = false;
    if (ws) {
      // Keep the socket's own error/close listeners alive until it has fully
      // closed. Closing a still-CONNECTING socket aborts the handshake, and
      // Node's `ws` then emits `'error'` on a later tick; removing `onerror`
      // first would leave that event unhandled and Node's EventEmitter would
      // throw an uncaught exception (browsers/undici stay silent, so this
      // only bites the test transport). The handlers below swallow the
      // resulting error/close without scheduling a reconnect — the socket is
      // already detached from `this.ws`, so `onDown`'s `this.active` check is
      // moot, but the no-op keeps intent explicit.
      ws.onopen = ws.onmessage = null;
      ws.onerror = () => {};
      ws.onclose = () => {};
      try { ws.close(); } catch { /* already closed */ }
    }
  }

  private open(): void {
    if (!this.active || !this.Impl) return;
    let ws: WebSocket;
    try {
      ws = new this.Impl(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      // (Re)bind: authenticate and name the pet. The server answers with state
      // + the first frame.
      this.send({ t: "hello", token: this.token, petId: this.petId });
      this.bound = true;
    };
    ws.onmessage = (ev: MessageEvent) => this.onMessage(ev.data);
    ws.onclose = () => this.onDown(ws);
    ws.onerror = () => { /* the close handler drives the retry */ };
  }

  /** A socket went away: if we are still supposed to be live, retry. */
  private onDown(ws: WebSocket): void {
    if (this.ws === ws) {
      this.ws = null;
      this.bound = false;
    }
    if (this.active) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.active || this.retryTimer !== null) return;
    const delay = Math.min(this.maxDelay, this.baseDelay * 2 ** this.retries);
    this.retries++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private onMessage(data: unknown): void {
    let msg: {
      t?: unknown;
      lcd?: unknown;
      icons?: unknown;
      alive?: unknown;
      ageYears?: unknown;
      freq?: unknown;
      on?: unknown;
    };
    try {
      msg = JSON.parse(typeof data === "string" ? data : String(data));
    } catch {
      return; // ignore garbage
    }
    if (msg.t === "frame") {
      const lcd = readLcd(msg.lcd);
      if (!lcd) return; // no usable LCD payload: nothing to draw
      const icons = readIcons(msg.icons);
      for (const cb of this.frameCbs) cb(lcd, icons);
      return;
    }
    if (msg.t === "state") {
      // Do not trust the "sent on change" docstring: reflect whatever arrives.
      const s: LiveState = {
        alive: msg.alive === true,
        ageYears: typeof msg.ageYears === "number" ? msg.ageYears : 0,
      };
      for (const cb of this.stateCbs) cb(s);
      return;
    }
    if (msg.t === "buzzer") {
      // Coerce defensively: freq must be a finite non-negative number and `on`
      // is true only when explicitly true, so a malformed message can never
      // drive the piezo with a garbage frequency or a phantom tone.
      const freq = typeof msg.freq === "number" && Number.isFinite(msg.freq) ? Math.max(0, msg.freq) : 0;
      const b: LiveBuzzer = { freq, on: msg.on === true };
      for (const cb of this.buzzerCbs) cb(b);
    }
  }

  private send(obj: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) this.ws.send(JSON.stringify(obj));
  }
}

/**
 * Decode the wire `lcd` field into a full 32×16 0/1 buffer, or `null` when the
 * frame carries no usable LCD (so the handler ignores it rather than drawing an
 * empty screen). Prefers the compact base64 form; still accepts the legacy
 * 512-number array so a client can talk to a server that predates the codec.
 */
function readLcd(value: unknown): Uint8Array | null {
  const packed = decodeLcd(value);
  if (packed) return packed;
  if (Array.isArray(value)) {
    const out = new Uint8Array(LCD_WIDTH * LCD_HEIGHT);
    for (let i = 0; i < out.length && i < value.length; i++) out[i] = value[i] ? 1 : 0;
    return out;
  }
  return null;
}

/**
 * Decode the wire `icons` field into an `ICON_COUNT` 0/1 buffer. Absent or
 * malformed payloads degrade to the all-dim row; the legacy 8-number array is
 * accepted for the same back-compat reason as `readLcd`.
 */
function readIcons(value: unknown): Uint8Array {
  if (typeof value === "string") return decodeIcons(value);
  const out = new Uint8Array(ICON_COUNT);
  if (Array.isArray(value)) {
    for (let i = 0; i < out.length && i < value.length; i++) out[i] = value[i] ? 1 : 0;
  }
  return out;
}
