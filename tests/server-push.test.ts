import { describe, it, expect, beforeEach } from "vitest";
import { collectBeep, DEBOUNCE_MS, resetBeepDebounce, type BeepSink } from "../server/src/beeps";
import {
  sendPendingPush,
  webPushSender,
  type PushRepo,
  type PushSender,
  type PendingBeep,
  type PushSubLike,
} from "../server/src/push";

/**
 * Task 7 — beep collection (debounced, generic) and the Web-Push sweeper.
 *
 * Everything is injected, so these tests run without Postgres, WASM, or a
 * network: the repo is a tiny in-memory double, the sender is a recorded stub,
 * and the live-connection gate is a plain function. That is the whole point of
 * the design — the push path is testable in isolation and the gate cannot
 * accidentally be bypassed.
 */

/** Recorded calls of the fake VAPID sender. */
interface SenderCall {
  sub: PushSubLike;
  payload: { title: string; body: string; petId: string };
}

/**
 * The narrow repo surface the sweeper needs. `pendingBeeps` returns the beep
 * together with its owner's user id, because a push goes to a *user*, while the
 * beep row only names the pet (schema §3, no `kind`).
 */
function makeRepo(beeps: PendingBeep[], subs: PushSubLike[]) {
  const notified: string[] = [];
  const removed: string[] = [];
  const row: PushRepo = {
    async pendingBeeps() {
      return beeps.filter((b) => !notified.includes(b.id));
    },
    async listPushSubs(userId: string) {
      return subs.filter((s) => s.userId === userId);
    },
    async markBeepNotified(id: string) {
      notified.push(id);
    },
    async removePushSub(id: string) {
      removed.push(id);
    },
  };
  return { row, notified, removed };
}

function makeSender(): { sender: PushSender; calls: SenderCall[] } {
  const calls: SenderCall[] = [];
  const sender: PushSender = {
    async send(sub, payload) {
      calls.push({ sub, payload });
    },
  };
  return { sender, calls };
}

const SUB: PushSubLike = {
  id: "sub-1",
  userId: "user-1",
  endpoint: "https://push.example/abc",
  p256dh: "p256dh-key",
  auth: "auth-secret",
};

const BEEP: PendingBeep = { id: "beep-1", petId: "pet-1", userId: "user-1" };

describe("collectBeep — debounced, generic beep events", () => {
  beforeEach(() => resetBeepDebounce());

  /** A sink double that just records what got inserted. */
  function makeSink() {
    const inserted: string[] = [];
    const sink: BeepSink = {
      async recordBeep(petId: string) {
        inserted.push(petId);
      },
    };
    return { sink, inserted };
  }

  it("records a beep when the latch fires", async () => {
    const { sink, inserted } = makeSink();
    await collectBeep(sink, "pet-1", true, 0);
    expect(inserted).toEqual(["pet-1"]);
  });

  it("does nothing when the latch is quiet", async () => {
    const { sink, inserted } = makeSink();
    await collectBeep(sink, "pet-1", false, 0);
    expect(inserted).toEqual([]);
  });

  it("debounces a second latch inside the window into one event", async () => {
    const { sink, inserted } = makeSink();
    await collectBeep(sink, "pet-1", true, 1_000);
    await collectBeep(sink, "pet-1", true, 1_000 + DEBOUNCE_MS - 1);
    expect(inserted).toEqual(["pet-1"]);
  });

  it("records again once the debounce window has passed", async () => {
    const { sink, inserted } = makeSink();
    await collectBeep(sink, "pet-1", true, 1_000);
    await collectBeep(sink, "pet-1", true, 1_000 + DEBOUNCE_MS);
    expect(inserted).toEqual(["pet-1", "pet-1"]);
  });

  it("debounces per pet, not globally", async () => {
    const { sink, inserted } = makeSink();
    await collectBeep(sink, "pet-1", true, 0);
    await collectBeep(sink, "pet-2", true, 0);
    expect(inserted).toEqual(["pet-1", "pet-2"]);
  });

  it("DEBOUNCE_MS matches the measured safe window (60 s)", () => {
    expect(DEBOUNCE_MS).toBe(60_000);
  });
});

describe("sendPendingPush — Web Push gated on hasLiveConnection", () => {
  let repo: ReturnType<typeof makeRepo>;
  let sender: ReturnType<typeof makeSender>;

  beforeEach(() => {
    repo = makeRepo([BEEP], [SUB]);
    sender = makeSender();
  });

  it("sends one generic push and marks the beep notified when offline", async () => {
    const result = await sendPendingPush({
      repo: repo.row,
      sender: sender.sender,
      hasLiveConnection: () => false,
      vapid: { subject: "mailto:ops@example.com", publicKey: "pub", privateKey: "priv" },
    });

    expect(sender.calls).toHaveLength(1);
    expect(repo.notified).toEqual(["beep-1"]);
    expect(result).toEqual({ sent: 1, beeps: 1 });

    // The notification content is generic — no cause, just the pet id as tag.
    const call = sender.calls[0];
    expect(call.sub.endpoint).toBe(SUB.endpoint);
    expect(call.payload.petId).toBe("pet-1");
    expect(call.payload.title).toBeTruthy();
    expect(call.payload.body).toBeTruthy();
  });

  it("does not send anything while the user has a live connection", async () => {
    const result = await sendPendingPush({
      repo: repo.row,
      sender: sender.sender,
      hasLiveConnection: () => true,
      vapid: { subject: "mailto:ops@example.com", publicKey: "pub", privateKey: "priv" },
    });

    expect(sender.calls).toHaveLength(0);
    // Still pending: the user just has to look at the tab, not miss the event.
    expect(repo.notified).toEqual([]);
    expect(result).toEqual({ sent: 0, beeps: 0 });
  });

  it("deletes the subscription on 410 Gone but keeps the beep pending", async () => {
    const gone: PushSender = {
      async send() {
        const err = new Error("Gone") as Error & { statusCode: number };
        err.statusCode = 410;
        throw err;
      },
    };

    const result = await sendPendingPush({
      repo: repo.row,
      sender: gone,
      hasLiveConnection: () => false,
      vapid: { subject: "mailto:ops@example.com", publicKey: "pub", privateKey: "priv" },
    });

    expect(repo.removed).toEqual(["sub-1"]);
    // No successful delivery, so the beep stays pending for a retry.
    expect(repo.notified).toEqual([]);
    expect(result).toEqual({ sent: 0, beeps: 0 });
  });

  it("keeps the row pending on a transient error (retry with backoff)", async () => {
    const flaky: PushSender = {
      async send() {
        const err = new Error("boom") as Error & { statusCode: number };
        err.statusCode = 500;
        throw err;
      },
    };

    await sendPendingPush({
      repo: repo.row,
      sender: flaky,
      hasLiveConnection: () => false,
      vapid: { subject: "mailto:ops@example.com", publicKey: "pub", privateKey: "priv" },
    });

    expect(repo.removed).toEqual([]);
    expect(repo.notified).toEqual([]);
  });

  it("skips pets whose owner is watching, pushing only the others", async () => {
    const otherSub: PushSubLike = { ...SUB, id: "sub-2", userId: "user-2", endpoint: "https://push.example/xyz" };
    repo = makeRepo(
      [BEEP, { id: "beep-2", petId: "pet-2", userId: "user-2" }],
      [SUB, otherSub],
    );
    sender = makeSender();

    const result = await sendPendingPush({
      repo: repo.row,
      sender: sender.sender,
      hasLiveConnection: (userId) => userId === "user-1",
      vapid: { subject: "mailto:ops@example.com", publicKey: "pub", privateKey: "priv" },
    });

    expect(sender.calls.map((c) => c.payload.petId)).toEqual(["pet-2"]);
    expect(repo.notified).toEqual(["beep-2"]);
    expect(result).toEqual({ sent: 1, beeps: 1 });
  });

  it("marks the beep notified per beep, not per subscription", async () => {
    const second: PushSubLike = { ...SUB, id: "sub-2", endpoint: "https://push.example/two" };
    repo = makeRepo([BEEP], [SUB, second]);
    sender = makeSender();

    const result = await sendPendingPush({
      repo: repo.row,
      sender: sender.sender,
      hasLiveConnection: () => false,
      vapid: { subject: "mailto:ops@example.com", publicKey: "pub", privateKey: "priv" },
    });

    expect(sender.calls).toHaveLength(2);
    expect(repo.notified).toEqual(["beep-1"]);
    expect(result).toEqual({ sent: 2, beeps: 1 });
  });
});

describe("webPushSender — production wiring", () => {
  it("forwards endpoint, keys, JSON payload and VAPID details to web-push", async () => {
    const calls: unknown[][] = [];
    const stub = {
      async sendNotification(...args: unknown[]) {
        calls.push(args);
        return {};
      },
    };
    const vapid = { subject: "mailto:ops@example.com", publicKey: "pub", privateKey: "priv" };
    const sender = webPushSender(stub, vapid);

    await sender.send(SUB, { title: "t", body: "b", petId: "pet-1" });

    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toEqual({
      endpoint: SUB.endpoint,
      keys: { p256dh: SUB.p256dh, auth: SUB.auth },
    });
    expect(JSON.parse(calls[0][1] as string)).toEqual({ title: "t", body: "b", petId: "pet-1" });
    expect(calls[0][2]).toEqual({ vapidDetails: vapid });
  });

  it("propagates a 410 error so the sweeper can delete the subscription", async () => {
    const stub = {
      async sendNotification() {
        const err = new Error("Gone") as Error & { statusCode: number };
        err.statusCode = 410;
        throw err;
      },
    };
    const sender = webPushSender(stub, { subject: "s", publicKey: "p", privateKey: "v" });
    await expect(sender.send(SUB, { title: "t", body: "b", petId: "pet-1" })).rejects.toMatchObject({
      statusCode: 410,
    });
  });
});
