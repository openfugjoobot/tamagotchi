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

export const recordKey = (sub: string): string => `save:${sub}`;

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
