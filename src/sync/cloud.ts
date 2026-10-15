// Cloud-Spielstand: dünne Hülle um /api/save plus die Sync-Entscheidung.
import { SAVE_API } from "../auth/config";
import type { Device } from "../emu/devices";

/**
 * Query-Anhang fuer den Geraete-Slot.
 *
 * P1 bleibt am alten Endpunkt ohne Parameter - der Worker bildet daraus den
 * gewohnten Schluessel und kein Bestandsnutzer verliert seinen Stand. Nur P2
 * bekommt einen eigenen Slot daneben.
 */
export function deviceQuery(device: Device): string {
  return device === "p2" ? "?device=p2" : "";
}

function apiFor(device: Device, deps: CloudDeps): string {
  return (deps.api ?? SAVE_API) + deviceQuery(device);
}

export interface CloudSave {
  snapshot: string;
  updatedAt: string;
  saveVer?: number;
}

export interface CloudDeps {
  fetchImpl?: typeof fetch;
  api?: string;
  /** Obergrenze fuer den Abruf. Standard 4000 ms (wie bisher im Login-Pfad). */
  timeoutMs?: number;
}

/**
 * Ergebnis eines Cloud-Abrufs. Der entscheidende Punkt: „es gibt keinen Stand"
 * (absent) und „ich konnte nicht nachsehen" (error) sind VERSCHIEDENE Dinge.
 * Frueher fielen beide auf null zusammen, und der Login-Pfad hat daraus einen
 * stillen Upload gemacht - ein Netzfehler konnte so den Cloud-Stand ueberschreiben.
 */
export type ReadResult =
  | { kind: "absent" }
  | { kind: "found"; save: CloudSave }
  | { kind: "error"; reason: string };

const AUTH_SCHEME = "Bearer ";

function headers(token: string): Record<string, string> {
  return { authorization: `${AUTH_SCHEME}${token}`, "content-type": "application/json" };
}

/**
 * Cloud-Stand holen - mit unterscheidbarem Ergebnis.
 *
 * Wichtig fuer den Login-Pfad: ein gescheiterter Abruf (Netz, 5xx, Timeout,
 * kaputter Body) darf NICHT wie „keine Cloud vorhanden" behandelt werden.
 * Sonst wird ein lokaler Stand hochgeladen, weil man nicht nachsehen konnte.
 */
export async function readSave(token: string, device: Device, deps: CloudDeps = {}): Promise<ReadResult> {
  const f = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 4000;
  let timer = 0;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs) as unknown as number;
  });
  try {
    const res = await Promise.race([
      f(apiFor(device, deps), { headers: headers(token), cache: "no-store" }),
      limit,
    ]);
    if (res.status === 404) return { kind: "absent" };
    if (!res.ok) return { kind: "error", reason: `HTTP ${res.status}` };
    const body = (await res.json()) as CloudSave;
    if (!body || typeof body.snapshot !== "string" || typeof body.updatedAt !== "string") {
      return { kind: "error", reason: "ungueltiger Body" };
    }
    return { kind: "found", save: body };
  } catch (e) {
    return { kind: "error", reason: e instanceof Error ? e.message : "Abruf gescheitert" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Was soll der Abgleich tun? Eine Stelle fuer beide Pfade (Boot und Login).
 *
 * Regeln:
 *   error  -> none  (nie still hochladen, wenn man nicht nachsehen konnte)
 *   absent -> push, wenn lokal vorhanden, sonst none
 *   found + kein lokaler Stand -> pull  (frischer Browser: Cloud laden, NIE ueberschreiben)
 *   found + Cloud neuer        -> "ask" (anderes Geraet hat echten Fortschritt)
 *   found + lokal gleich/neuer -> push  (Normalfall: lokal weiter, still hochladen)
 *
 * Der Login-Pfad will staerker fragen: sobald beim Anmelden ueberhaupt ein Cloud-Stand
 * existiert, soll die Wahl angeboten werden - auch wenn lokal neuer ist. Denn eine
 * frisch gestartete Session hat lokal "jetzt", aber ihr Stand ist wertlos; er darf die
 * Cloud nicht still ueberschreiben. Dafuer gibt es `forceAsk`.
 */
export type SyncAction = "push" | "pull" | "none" | "ask";

export function planSync(cloud: ReadResult, localAt: number | null, opts: { forceAsk?: boolean } = {}): SyncAction {
  const hasLocal = typeof localAt === "number" && Number.isFinite(localAt);
  if (cloud.kind === "error") return "none";
  if (cloud.kind === "absent") return hasLocal ? "push" : "none";
  // Cloud hat einen Stand.
  if (!hasLocal) return "pull";
  // Beim Anmelden: Cloud-Stand da + lokaler Stand da -> immer fragen.
  if (opts.forceAsk) return "ask";
  const cloudAt = Date.parse(cloud.save.updatedAt);
  if (!Number.isFinite(cloudAt)) return "push"; // kaputter Cloud-Zeitstempel: lokal gewinnt
  return cloudAt > localAt! ? "ask" : "push";
}

/** Cloud-Stand hochladen. true = angenommen (oder serverseitig als älter verworfen). */
export async function pushSave(token: string, device: Device, rec: CloudSave, deps: CloudDeps = {}): Promise<boolean> {
  const f = deps.fetchImpl ?? fetch;
  try {
    const res = await f(apiFor(device, deps), { method: "PUT", headers: headers(token), body: JSON.stringify(rec) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Serverstand löschen (Datenschutz). */
export async function deleteRemote(token: string, device: Device, deps: CloudDeps = {}): Promise<boolean> {
  const f = deps.fetchImpl ?? fetch;
  try {
    const res = await f(apiFor(device, deps), { method: "DELETE", headers: headers(token) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Soll gefragt werden? Nur wenn die Cloud neuer ist als der lokale Stand - dann
 * koennte ein anderes Geraet echten Fortschritt haben. Ist lokal gleich alt oder
 * neuer (Normalfall), wird still der lokale Stand hochgeladen.
 */
export function needsPrompt(localAt: number | null, cloudUpdatedAt: string | null): boolean {
  const hasLocal = typeof localAt === "number" && Number.isFinite(localAt);
  const cloudAt = cloudUpdatedAt ? Date.parse(cloudUpdatedAt) : NaN;
  if (!hasLocal || !Number.isFinite(cloudAt)) return false;
  return cloudAt > localAt!;
}
