/**
 * Web Push sweeper — sends pending beeps to offline users.
 *
 * Design (spec §4):
 *   * A beep is pushed only when the user has **no live WebSocket connection**.
 *     If they are watching, they already see and hear it; a system notification
 *     would be a duplicate. `hasLiveConnection` (from `ws.ts`) is that gate.
 *   * The notification is **generic** — a title/body with no cause, because no
 *     cause is ever known. `tag = pet:<id>` so follow-up beeps replace the
 *     previous notification instead of stacking, and a click focuses that pet.
 *   * Delivery is all-or-nothing per beep: only a *successful* send to at least
 *     one subscription flips `notified_at`. `410 Gone` (the browser dropped the
 *     subscription) deletes that row silently; any other error leaves the beep
 *     pending, so the next sweep retries it (backoff is the sweep interval).
 *
 * Everything is injected — repo, sender, gate, VAPID — so this module has no
 * Postgres, no `web-push`, and no network at import time, and the whole path is
 * unit-testable.
 */

/**
 * A beep waiting to be delivered, **already joined to its owner** (a beep row
 * only names a pet, so the owner has to come from `beeps → pets → users`).
 * This is exactly the shape `Repo.pendingBeeps()` returns — the join lives in
 * the repository, not here, so the sweeper stays free of SQL.
 */
export interface PendingBeep {
  id: string;
  petId: string;
  userId: string;
}

/** A push subscription, as the sender needs it. */
export interface PushSubLike {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Notification payload handed to the service worker (Task 12). */
export interface PushPayload {
  title: string;
  body: string;
  petId: string;
}

/**
 * The repo surface the sweeper needs. Satisfied structurally by `Repo` — keep
 * the two in lockstep; a signature drift here is invisible to `tsc` whenever
 * both sides are `string` (see `removePushSub`), so the integration test in
 * `tests/server-push.test.ts` wires the **real** `Repo` in to catch it.
 */
export interface PushRepo {
  /** Beeps with `notified_at IS NULL`, each with its owner's user id (joined). */
  pendingBeeps(): Promise<PendingBeep[]>;
  listPushSubs(userId: string): Promise<PushSubLike[]>;
  markBeepNotified(id: string): Promise<void>;
  /**
   * Drop a push subscription on `410 Gone`. Keyed by **endpoint**, matching
   * `Repo.removePushSub(endpoint)` and the `push_subs.endpoint` unique key —
   * not by row `id`, which would silently match nothing.
   */
  removePushSub(endpoint: string): Promise<void>;
}

/**
 * The VAPID sender. `send` resolves on delivery and rejects with an HTTP-status
 * carrying error on failure — the shape `web-push` itself throws.
 */
export interface PushSender {
  send(sub: PushSubLike, payload: PushPayload): Promise<void>;
}

export interface VapidKeys {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export interface SendPendingPushDeps {
  repo: PushRepo;
  sender: PushSender;
  /** Push gate: true while the user watches the pet over a live socket. */
  hasLiveConnection: (userId: string) => boolean;
  vapid: VapidKeys;
}

export interface SendPendingPushResult {
  /** Successful (beep, subscription) deliveries to the push service. */
  sent: number;
  /** Pending beeps that had at least one successful delivery and were marked. */
  beeps: number;
}

/**
 * Build a `PushSender` from a `web-push`-shaped module and VAPID keys.
 *
 * Kept here (not imported from the package) so `push.ts` has no `web-push`
 * dependency at import time: production passes the real module, tests pass a
 * stub. `sendNotification` rejecting with a status-carrying error is exactly
 * what `web-push` does, which is what makes the `410` cleanup work.
 */
export function webPushSender(
  webpush: {
    sendNotification(
      sub: { endpoint: string; keys: { p256dh: string; auth: string } },
      payload: string,
      options: { vapidDetails: { subject: string; publicKey: string; privateKey: string } },
    ): Promise<unknown>;
  },
  vapid: SendPendingPushDeps["vapid"],
): PushSender {
  return {
    async send(sub, payload) {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey } },
      );
    },
  };
}
const BEEP_TITLE = "Dein Tamagotchi braucht dich";
const BEEP_BODY = "Ein Blick auf dein Tier lohnt sich gerade.";

function isGone(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { statusCode?: number }).statusCode === 410;
}

/**
 * One sweep: for every pending beep whose owner is offline, push to all of that
 * user's subscriptions. Returns delivery counters (mainly for logs/tests).
 */
export async function sendPendingPush(
  deps: SendPendingPushDeps,
): Promise<SendPendingPushResult> {
  const beeps = await deps.repo.pendingBeeps();
  let sent = 0;
  let notified = 0;

  for (const beep of beeps) {
    // The gate: a watching user already heard the beep. Stay quiet.
    if (deps.hasLiveConnection(beep.userId)) continue;

    const payload: PushPayload = {
      title: BEEP_TITLE,
      body: BEEP_BODY,
      petId: beep.petId,
    };

    const subsForUser = await deps.repo.listPushSubs(beep.userId);
    let delivered = 0;

    for (const sub of subsForUser) {
      try {
        await deps.sender.send(sub, payload);
        delivered++;
      } catch (err) {
        if (isGone(err)) {
          // The subscription is dead: drop it so we stop retrying it. Keyed by
          // endpoint — `Repo.removePushSub` deletes `where endpoint = $1`.
          await deps.repo.removePushSub(sub.endpoint);
        }
        // Any other error: leave the beep pending for the next sweep.
      }
    }

    if (delivered > 0) {
      sent += delivered;
      notified += 1;
      await deps.repo.markBeepNotified(beep.id);
    }
  }

  return { sent, beeps: notified };
}
