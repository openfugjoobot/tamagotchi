import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

/**
 * Service-worker push receiver — Task 12.
 *
 * The plan wants the push handler exercised through a fake `self`, but
 * `public/sw.js` is a *classic* worker script carrying the `__SW_VERSION__`
 * build placeholder: it cannot be imported by Vitest (no module format). So the
 * push logic lives in its own classic script, `public/sw-push.js`, which `sw.js`
 * pulls in with `importScripts` — exactly the extraction pattern Task 11 used for
 * the boot overlay. The test loads that file into a fresh VM context whose
 * globals stand in for the worker's `self`/`clients`, then dispatches real
 * `PushEvent`/`NotificationEvent` shapes at it.
 *
 * Contract under test (spec §4, Task 7 payload `{title, body, petId}`):
 *   * `push` shows a notification whose `tag` is `pet:<petId>`, so follow-up
 *     beeps for the same pet *replace* rather than stack.
 *   * `notificationclick` focuses an existing window when there is one, else
 *     opens `/`.
 *   * a payload that is missing/garbled must not throw — the worker stays alive.
 */

/** Minimal `ExtendableEvent` shape: captures the promise passed to `waitUntil`. */
interface FakeEvent {
  /** Real PushEvents carry `data` (a PushMessageData with `.json()`/`.text()`). */
  data?: { json(): unknown };
  notification?: { close(): void; data?: unknown };
  waitUntil(p: unknown): void;
  _promises: unknown[];
}

function makeEvent(extra: Partial<FakeEvent> = {}): FakeEvent {
  const promises: unknown[] = [];
  return {
    waitUntil(p) { promises.push(p); },
    _promises: promises,
    ...extra,
  };
}

/** A `PushEvent` whose `data.json()` returns `payload` (or throws for garbled). */
function pushEvent(payload: unknown, garbled = false): FakeEvent {
  return makeEvent({
    data: { json: () => { if (garbled) throw new SyntaxError("bad json"); return payload; } },
  });
}

interface Harness {
  listeners: Map<string, (e: FakeEvent) => void>;
  shown: Array<{ title: string; options: Record<string, unknown> }>;
  focused: number;
  opened: string[];
  /** Run the listener for `type` with `event`; await whatever it deferred. */
  fire(type: string, event: FakeEvent): Promise<void>;
}

/**
 * Load `public/sw-push.js` into a fresh VM context and capture the listeners it
 * registers on the injected `self`. `clients` is fully injected so the focus and
 * openWindow branches are both reachable.
 */
function loadSwPush(clients: {
  matchAll?: () => Promise<Array<Record<string, unknown>>>;
  openWindow?: (url: string) => Promise<unknown>;
} = {}): Harness {
  const code = readFileSync(resolve(__dirname, "../public/sw-push.js"), "utf8");

  const listeners = new Map<string, (e: FakeEvent) => void>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const focused: { count: number } = { count: 0 };
  const opened: string[] = [];

  const self = {
    addEventListener(type: string, fn: (e: FakeEvent) => void) { listeners.set(type, fn); },
    registration: {
      showNotification(title: string, options: Record<string, unknown>) {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {
      matchAll: clients.matchAll ?? (() => Promise.resolve([])),
      openWindow: clients.openWindow ?? ((url: string) => { opened.push(url); return Promise.resolve(null); }),
    },
  };

  const sandbox = { self, console };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "sw-push.js" });

  return {
    listeners,
    shown,
    get focused() { return focused.count; },
    opened,
    async fire(type, event) {
      const fn = listeners.get(type);
      if (!fn) throw new Error(`no ${type} listener registered`);
      fn(event);
      await Promise.all(event._promises);
    },
  };
}

describe("service worker — push receiver (Task 12)", () => {
  it("shows a notification tagged pet:<id> from the Task-7 payload", async () => {
    const sw = loadSwPush();

    await sw.fire("push", pushEvent({ title: "Dein Tamagotchi braucht dich", body: "Es ruft", petId: "pet-42" }));

    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0].title).toBe("Dein Tamagotchi braucht dich");
    expect(sw.shown[0].options.body).toBe("Es ruft");
    // tag makes a follow-up beep for the same pet replace, not stack.
    expect(sw.shown[0].options.tag).toBe("pet:pet-42");
  });

  it("uses the petId in the tag so different pets do not overwrite each other", async () => {
    const sw = loadSwPush();
    await sw.fire("push", pushEvent({ title: "t", body: "b", petId: "a" }));
    await sw.fire("push", pushEvent({ title: "t", body: "b", petId: "b" }));

    expect(sw.shown.map((s) => s.options.tag)).toEqual(["pet:a", "pet:b"]);
  });

  it("focuses an existing window on notificationclick", async () => {
    let focus = 0;
    const sw = loadSwPush({
      matchAll: () => Promise.resolve([
        { url: "https://tamagotchi.fugjoo.com/", focus: () => { focus++; return Promise.resolve(); } },
      ]),
    });
    const notif = { close() { /* counted below */ }, data: { petId: "pet-1" } };
    let closed = 0;
    notif.close = () => { closed++; };

    await sw.fire("notificationclick", makeEvent({ notification: notif }));

    expect(closed).toBe(1);
    expect(focus).toBe(1);
    expect(sw.opened).toEqual([]); // an existing tab was focused, not opened anew
  });

  it("opens the app when no window is available", async () => {
    const sw = loadSwPush({ matchAll: () => Promise.resolve([]) });

    await sw.fire("notificationclick", makeEvent({ notification: { close() {}, data: { petId: "p" } } }));

    expect(sw.opened).toEqual(["/"]);
  });

  it("does not throw on a payload without petId (worker must stay alive)", async () => {
    const sw = loadSwPush();
    await sw.fire("push", pushEvent({ title: "nur ein Titel" }));
    // A missing petId still yields a notification; the tag just has no pet id.
    expect(sw.shown).toHaveLength(1);
    expect(String(sw.shown[0].options.tag).startsWith("pet:")).toBe(true);
  });

  it("survives a payload that is not an object", async () => {
    const sw = loadSwPush();
    await expect(sw.fire("push", pushEvent(null))).resolves.toBeUndefined();
    expect(sw.shown).toHaveLength(1);
  });

  it("survives a garbled payload (data.json() throws)", async () => {
    const sw = loadSwPush();
    await expect(sw.fire("push", pushEvent(undefined, true))).resolves.toBeUndefined();
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0].title).toBe("Tamagotchi");
  });

  it("sw.js wires the handlers without touching the precache logic", () => {
    const sw = readFileSync(resolve(__dirname, "../public/sw.js"), "utf8");
    // The extracted module is pulled in and both listeners are registered...
    expect(sw).toContain("importScripts");
    expect(sw).toContain("sw-push.js");
    // ...and the precache/offline machinery is still present (not replaced).
    expect(sw).toContain("precache.json");
    expect(sw).toMatch(/addEventListener\("install"/);
    expect(sw).toContain("/offline.html");
  });

  it("keeps the build placeholder so the version stamp still works", () => {
    const sw = readFileSync(resolve(__dirname, "../public/sw.js"), "utf8");
    expect(sw).toContain("__SW_VERSION__");
  });
});
