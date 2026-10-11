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
}

const AUTH_SCHEME = "Bearer ";

function headers(token: string): Record<string, string> {
  return { authorization: `${AUTH_SCHEME}${token}`, "content-type": "application/json" };
}

/** Cloud-Stand holen; null, wenn keiner existiert oder das Netz weg ist. */
export async function pullSave(token: string, deps: CloudDeps = {}): Promise<CloudSave | null> {
  const f = deps.fetchImpl ?? fetch;
  try {
    const res = await f(deps.api ?? SAVE_API, { headers: headers(token), cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const body = (await res.json()) as CloudSave;
    return body && typeof body.snapshot === "string" ? body : null;
  } catch {
    return null;
  }
}

/** Stand hochladen. true = angenommen (oder serverseitig als älter verworfen). */
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
 * Soll der Nutzer gefragt werden? Nur wenn die Cloud neuer ist – dann wuerde sie
 * den lokalen Stand ueberschreiben. Ist lokal neuer (Normalfall: hier wurde gerade
 * gespielt), wird einfach hochgeschoben, ohne Nachfrage.
 */
export function needsPrompt(localAt: number | null, cloudUpdatedAt: string | null): boolean {
  const cloudAt = cloudUpdatedAt ? Date.parse(cloudUpdatedAt) : NaN;
  if (typeof localAt !== "number" || !Number.isFinite(localAt)) return false;
  if (!Number.isFinite(cloudAt)) return false;
  return cloudAt > localAt;
}

/**
 * Was beim Start tun? Es gibt kein Merging — nur „welcher Snapshot ist neuer".
 * localAt = Zeitstempel des lokalen Speicherns (ms), cloudUpdatedAt = ISO aus der Cloud.
 */
export function decideSync(localAt: number | null, cloudUpdatedAt: string | null): "push" | "pull" | "none" {
  const cloudAt = cloudUpdatedAt ? Date.parse(cloudUpdatedAt) : NaN;
  const hasLocal = typeof localAt === "number" && Number.isFinite(localAt);
  const hasCloud = Number.isFinite(cloudAt);
  if (!hasLocal && !hasCloud) return "none";
  if (!hasCloud) return "push";
  if (!hasLocal) return "pull";
  if (cloudAt > localAt!) return "pull";
  if (localAt! > cloudAt) return "push";
  return "none";
}
