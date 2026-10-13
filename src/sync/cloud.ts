// Cloud-Spielstand: dünne Hülle um /api/save plus die Sync-Entscheidung.
import { SAVE_API } from "../auth/config";

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
export async function readSave(token: string, deps: CloudDeps = {}): Promise<ReadResult> {
  const f = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 4000;
  let timer = 0;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs) as unknown as number;
  });
  try {
    const res = await Promise.race([
      f(deps.api ?? SAVE_API, { headers: headers(token), cache: "no-store" }),
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
 *   found + lokaler Stand      -> "ask" (beide da: immer nachfragen, nichts still ueberschreiben)
 *
 * Warum kein Zeitstempel-Vergleich mehr: ein frisch geschluepftes Ei in einem neuen
 * Browser hat den Zeitstempel "jetzt" und galt damit als neuester Stand - der
 * Login-Pfad lud ihn still hoch und ueberschrieb den echten Cloud-Fortschritt.
 * Zeitstempel koennen "frisches Ei" nicht von "echtem Fortschritt" trennen.
 */
export type SyncAction = "push" | "pull" | "none" | "ask";

export function planSync(cloud: ReadResult, localAt: number | null): SyncAction {
  const hasLocal = typeof localAt === "number" && Number.isFinite(localAt);
  if (cloud.kind === "error") return "none";
  if (cloud.kind === "absent") return hasLocal ? "push" : "none";
  // Cloud hat einen Stand.
  if (!hasLocal) return "pull";
  return "ask";
}

/** Cloud-Stand hochladen. true = angenommen (oder serverseitig als älter verworfen). */
export async function pushSave(token: string, rec: CloudSave, deps: CloudDeps = {}): Promise<boolean> {
  const f = deps.fetchImpl ?? fetch;
  try {
    const res = await f(deps.api ?? SAVE_API, { method: "PUT", headers: headers(token), body: JSON.stringify(rec) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Serverstand löschen (Datenschutz). */
export async function deleteRemote(token: string, deps: CloudDeps = {}): Promise<boolean> {
  const f = deps.fetchImpl ?? fetch;
  try {
    const res = await f(deps.api ?? SAVE_API, { method: "DELETE", headers: headers(token) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Soll der Nutzer gefragt werden? Immer, wenn lokal UND Cloud einen Stand haben -
 * egal wer "neuer" ist. Nur so kann ein frisches Ei den echten Cloud-Stand nicht
 * still ueberschreiben (und umgekehrt).
 */
export function needsPrompt(localAt: number | null, cloudUpdatedAt: string | null): boolean {
  const hasLocal = typeof localAt === "number" && Number.isFinite(localAt);
  const hasCloud = !!cloudUpdatedAt && Number.isFinite(Date.parse(cloudUpdatedAt));
  return hasLocal && hasCloud;
}
