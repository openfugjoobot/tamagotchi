import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket as NodeWs } from "ws";
import { LiveClient } from "@/net/live";

/**
 * A fake live server: accepts `/ws`, records every message it receives, and
 * lets the test push frames/state to the connected client. It speaks the exact
 * Task-6 protocol (`hello` in, `frame`/`state` out, `press` in) without
 * Postgres, Google or WASM.
 */
class FakeLiveServer {
  private server: Server;
  private wss: WebSocketServer;
  readonly received: Array<Record<string, unknown>> = [];
  private sockets = new Set<NodeWs>();
  port = 0;

  constructor() {
    this.server = createServer();
    this.wss = new WebSocketServer({ noServer: true });
    this.server.on("upgrade", (req, socket, head) => {
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws, req));
    });
    this.wss.on("connection", (ws) => {
      this.sockets.add(ws);
      ws.on("message", (data) => {
        try {
          this.received.push(JSON.parse(String(data)) as Record<string, unknown>);
        } catch {
          /* ignore */
        }
      });
      ws.on("close", () => this.sockets.delete(ws));
      ws.on("error", () => this.sockets.delete(ws));
    });
  }

  async listen(): Promise<string> {
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", () => r()));
    this.port = (this.server.address() as { port: number }).port;
    return `ws://127.0.0.1:${this.port}/ws`;
  }

  /** Push a message to every connected socket. */
  broadcast(msg: Record<string, unknown>): void {
    const text = JSON.stringify(msg);
    for (const ws of this.sockets) if (ws.readyState === NodeWs.OPEN) ws.send(text);
  }

  /** Number of sockets the server currently holds open. */
  openSockets(): number {
    return this.sockets.size;
  }

  /** Close every socket from the server side (simulates a dropped link). */
  dropAll(): void {
    for (const ws of this.sockets) ws.terminate();
    this.sockets.clear();
  }

  async close(): Promise<void> {
    for (const ws of this.sockets) ws.terminate();
    this.sockets.clear();
    await new Promise<void>((r) => this.wss.close(() => r()));
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}

function waitUntil(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (pred()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("timeout"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

let client: LiveClient | null = null;
let server: FakeLiveServer | null = null;

afterEach(async () => {
  client?.disconnect();
  client = null;
  if (server) await server.close();
  server = null;
});

describe("LiveClient", () => {
  it("sends a hello with the token and petId once connected", async () => {
    server = new FakeLiveServer();
    const url = await server.listen();
    client = new LiveClient({ url, WebSocketImpl: NodeWs as unknown as typeof WebSocket, reconnectDelayMs: 10 });
    client.connect("pet-1", "tok-123");
    await waitUntil(() => server!.received.some((m) => m.t === "hello"));
    expect(server.received[0]).toEqual({ t: "hello", token: "tok-123", petId: "pet-1" });
  });

  it("delivers every frame to onFrame as a 32x16 buffer", async () => {
    server = new FakeLiveServer();
    const url = await server.listen();
    client = new LiveClient({ url, WebSocketImpl: NodeWs as unknown as typeof WebSocket, reconnectDelayMs: 10 });
    const frames: Uint8Array[] = [];
    client.onFrame((f) => frames.push(f));
    client.connect("pet-1", "tok");

    const a = new Array(512).fill(0);
    a[0] = 1;
    const b = new Array(512).fill(0);
    b[511] = 1;
    await waitUntil(() => server!.received.some((m) => m.t === "hello"));
    server.broadcast({ t: "frame", lcd: a });
    server.broadcast({ t: "frame", lcd: b });

    await waitUntil(() => frames.length === 2);
    expect(frames[0].length).toBe(512);
    expect(frames[0][0]).toBe(1);
    expect(frames[1][511]).toBe(1);
  });

  it("delivers the icon bits alongside the LCD, coercing them to 0/1", async () => {
    server = new FakeLiveServer();
    const url = await server.listen();
    client = new LiveClient({ url, WebSocketImpl: NodeWs as unknown as typeof WebSocket, reconnectDelayMs: 10 });
    const frames: Array<{ lcd: Uint8Array; icons: Uint8Array }> = [];
    client.onFrame((lcd, icons) => frames.push({ lcd, icons }));
    client.connect("pet-1", "tok");
    await waitUntil(() => server!.received.some((m) => m.t === "hello"));

    server.broadcast({ t: "frame", lcd: new Array(512).fill(0), icons: [0, 1, 0, 1, 0, 0, 0, 1] });
    await waitUntil(() => frames.length === 1);
    expect(frames[0].icons.length).toBe(8);
    expect(Array.from(frames[0].icons)).toEqual([0, 1, 0, 1, 0, 0, 0, 1]);
  });

  it("degrades to an all-zero icon row when a frame carries no icons", async () => {
    // A server that predates the icon extension must not break rendering.
    server = new FakeLiveServer();
    const url = await server.listen();
    client = new LiveClient({ url, WebSocketImpl: NodeWs as unknown as typeof WebSocket, reconnectDelayMs: 10 });
    const frames: Array<{ lcd: Uint8Array; icons: Uint8Array }> = [];
    client.onFrame((lcd, icons) => frames.push({ lcd, icons }));
    client.connect("pet-1", "tok");
    await waitUntil(() => server!.received.some((m) => m.t === "hello"));

    server.broadcast({ t: "frame", lcd: new Array(512).fill(0) });
    await waitUntil(() => frames.length === 1);
    expect(frames[0].icons.length).toBe(8);
    expect(Array.from(frames[0].icons)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("clamps a short or long icons array to exactly 8 bits", async () => {
    server = new FakeLiveServer();
    const url = await server.listen();
    client = new LiveClient({ url, WebSocketImpl: NodeWs as unknown as typeof WebSocket, reconnectDelayMs: 10 });
    const frames: Array<{ lcd: Uint8Array; icons: Uint8Array }> = [];
    client.onFrame((lcd, icons) => frames.push({ lcd, icons }));
    client.connect("pet-1", "tok");
    await waitUntil(() => server!.received.some((m) => m.t === "hello"));

    // Short: only 3 bits -> rest zero-filled. Long: extra bits ignored.
    server.broadcast({ t: "frame", lcd: new Array(512).fill(0), icons: [1, 1, 1] });
    await waitUntil(() => frames.length === 1);
    expect(Array.from(frames[0].icons)).toEqual([1, 1, 1, 0, 0, 0, 0, 0]);

    server.broadcast({ t: "frame", lcd: new Array(512).fill(1), icons: [1, 0, 1, 0, 1, 0, 1, 0, 1, 1] });
    await waitUntil(() => frames.length === 2);
    expect(Array.from(frames[1].icons)).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
  });

  it("press() sends a press message with the button name", async () => {
    server = new FakeLiveServer();
    const url = await server.listen();
    client = new LiveClient({ url, WebSocketImpl: NodeWs as unknown as typeof WebSocket, reconnectDelayMs: 10 });
    client.connect("pet-1", "tok");
    await waitUntil(() => server!.received.some((m) => m.t === "hello"));
    client.press("middle");
    await waitUntil(() => server!.received.some((m) => m.t === "press"));
    expect(server.received.find((m) => m.t === "press")).toEqual({ t: "press", btn: "middle" });
  });

  it("reports state messages to onState without trusting the docstring", async () => {
    server = new FakeLiveServer();
    const url = await server.listen();
    client = new LiveClient({ url, WebSocketImpl: NodeWs as unknown as typeof WebSocket, reconnectDelayMs: 10 });
    const states: Array<{ alive: boolean; ageYears: number }> = [];
    client.onState((s) => states.push(s));
    client.connect("pet-1", "tok");
    await waitUntil(() => server!.received.some((m) => m.t === "hello"));
    server.broadcast({ t: "state", alive: true, ageYears: 3 });
    server.broadcast({ t: "state", alive: false, ageYears: 4 });
    await waitUntil(() => states.length === 2);
    expect(states[0]).toEqual({ alive: true, ageYears: 3 });
    expect(states[1]).toEqual({ alive: false, ageYears: 4 });
  });

  it("reconnects automatically after the connection drops", async () => {
    server = new FakeLiveServer();
    const url = await server.listen();
    client = new LiveClient({
      url,
      WebSocketImpl: NodeWs as unknown as typeof WebSocket,
      reconnectDelayMs: 10,
      maxReconnectDelayMs: 20,
    });
    client.connect("pet-1", "tok");
    await waitUntil(() => server!.received.filter((m) => m.t === "hello").length === 1);

    // The server drops the link; the client must come back and re-send hello.
    server.dropAll();
    await waitUntil(() => server!.received.filter((m) => m.t === "hello").length >= 2, 4000);
    expect(server.received.filter((m) => m.t === "hello").length).toBeGreaterThanOrEqual(2);
  });

  it("connect() again rebinds to the new pet without leaving the old socket open", async () => {
    server = new FakeLiveServer();
    const url = await server.listen();
    client = new LiveClient({ url, WebSocketImpl: NodeWs as unknown as typeof WebSocket, reconnectDelayMs: 10 });
    client.connect("pet-1", "tok-1");
    await waitUntil(() => server!.received.some((m) => m.t === "hello" && m.petId === "pet-1"));
    client.connect("pet-2", "tok-2");
    await waitUntil(() => server!.received.some((m) => m.t === "hello" && m.petId === "pet-2"));
    // Exactly one live socket remains after the switch (the old one is closed).
    await waitUntil(() => server!.openSockets() <= 1, 2000);
    await new Promise((r) => setTimeout(r, 60));
    const hellos = server!.received.filter((m) => m.t === "hello");
    expect(hellos.length).toBe(2);
    expect(hellos[1]).toEqual({ t: "hello", token: "tok-2", petId: "pet-2" });
    expect(server!.openSockets()).toBe(1);
  });

  it("disconnect() on a still-CONNECTING socket does not crash and leaves no socket open", async () => {
    // Regression: closeSocket() used to null `onerror` *before* calling close().
    // Closing a CONNECTING socket makes Node's `ws` abort the handshake and emit
    // `'error'` on the next tick; with no listener attached, the EventEmitter
    // threw "WebSocket was closed before the connection was established" as an
    // uncaught exception (vitest reports it as an unhandled error even when the
    // test itself passes). connect() + disconnect() in the same tick is the
    // shortest way to hit it, and is a real reconnect/teardown interleaving.
    server = new FakeLiveServer();
    const url = await server.listen();
    client = new LiveClient({ url, WebSocketImpl: NodeWs as unknown as typeof WebSocket, reconnectDelayMs: 10 });
    client.connect("pet-1", "tok");
    client.disconnect(); // same tick — socket is still CONNECTING

    // Give the aborted handshake's asynchronous 'error' a chance to surface.
    await new Promise((r) => setTimeout(r, 150));

    expect(client.status()).toBe("offline");
    // No reconnect: a disconnected client must stay quiet.
    expect(server.received.filter((m) => m.t === "hello").length).toBe(0);
    await waitUntil(() => server!.openSockets() === 0, 2000);
    expect(server.openSockets()).toBe(0);
  });

  it("connect() again on a still-CONNECTING socket does not crash and rebinds", async () => {
    // Same race, but via the reconnect/switch path: connect(p1) then immediately
    // connect(p2) drops a CONNECTING socket inside closeSocket(). The old bug
    // surfaced here as an uncaught handshake-abort error; the fix must swallow it
    // while still opening the new socket and binding to the new pet.
    server = new FakeLiveServer();
    const url = await server.listen();
    client = new LiveClient({ url, WebSocketImpl: NodeWs as unknown as typeof WebSocket, reconnectDelayMs: 10 });
    client.connect("pet-1", "tok-1");
    client.connect("pet-2", "tok-2"); // same tick — first socket still CONNECTING

    await waitUntil(() => server!.received.some((m) => m.t === "hello" && m.petId === "pet-2"), 3000);
    // Let the aborted first handshake's async 'error' surface before we finish.
    await new Promise((r) => setTimeout(r, 150));

    const hellos = server.received.filter((m) => m.t === "hello");
    expect(hellos.some((m) => m.petId === "pet-2")).toBe(true);
    // Only the second pet's socket should remain.
    await waitUntil(() => server!.openSockets() <= 1, 2000);
    expect(server.openSockets()).toBe(1);
  });

  it("goes offline on close and live once bound, and stops reconnecting on disconnect()", async () => {
    server = new FakeLiveServer();
    const url = await server.listen();
    client = new LiveClient({ url, WebSocketImpl: NodeWs as unknown as typeof WebSocket, reconnectDelayMs: 10 });
    expect(client.status()).toBe("offline");
    client.connect("pet-1", "tok");
    await waitUntil(() => client!.status() === "live");
    expect(client.status()).toBe("live");

    client.disconnect();
    expect(client.status()).toBe("offline");
    const hellos = server.received.filter((m) => m.t === "hello").length;
    await new Promise((r) => setTimeout(r, 120));
    expect(server.received.filter((m) => m.t === "hello").length).toBe(hellos);
  });
});
