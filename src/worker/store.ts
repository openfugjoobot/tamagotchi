// Speicher-Abstraktion für den Worker: ein KV-Eintrag pro Nutzer, Last-Write-Wins.

export interface SaveRecord {
  /** base64(gzip(WASM-Speicher)) */
  snapshot: string;
  /** ISO-Zeitstempel des Speicherns (Client). */
  updatedAt: string;
  /** Format-Version des Snapshots. */
  saveVer?: number;
}

/** Minimale KV-Sicht (kein @cloudflare/workers-types nötig). */
export interface SaveStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * KV-Schluessel eines Spielstands.
 *
 * P1 behaelt den alten Schluessel `save:<sub>` — so verliert kein Bestandsnutzer
 * seinen Stand. P2 und alles Weitere bekommen einen eigenen Eintrag daneben.
 */
export const recordKey = (sub: string, device: string): string =>
  device === "p1" ? `save:${sub}` : `save:${sub}:${device}`;

/** Unbekannte oder fehlende Geraeteangaben fallen auf P1 zurueck. */
export function normalizeDevice(raw: string | null): string {
  return raw === "p2" ? "p2" : "p1";
}

export function parseRecord(raw: string | null): SaveRecord | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as SaveRecord;
    return o && typeof o.snapshot === "string" && typeof o.updatedAt === "string" ? o : null;
  } catch {
    return null;
  }
}

/** Ist der eingehende Stand neuer als der gespeicherte? */
export function isNewer(incoming: SaveRecord, stored: SaveRecord | null): boolean {
  if (!stored) return true;
  const a = Date.parse(incoming.updatedAt);
  const b = Date.parse(stored.updatedAt);
  if (Number.isNaN(a)) return false;
  if (Number.isNaN(b)) return true;
  return a > b;
}
