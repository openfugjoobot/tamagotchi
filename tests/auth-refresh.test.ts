import { describe, it, expect, beforeEach } from "vitest";
import { gsiConfig, setSession, signOut, onSessionRefresh, credentialFromNotification } from "@/auth/google";
import { IDTOKEN_KEY } from "@/storage/keys";

// Regressionstest zum Bug "ich muss mich beim Google-Konto jedes Mal neu anmelden".
//
// Ursache: initGsi uebergab `auto_select: true`, aber KEINEN `moment_callback`.
// Google verlangt neben auto_select zwingend einen moment_callback; fehlt er,
// schaltet GIS den stillen Pfad ab und der Button rendert zwar, loest aber
// nichts aus. Zusaetzlich lief der Button ueber den abgekuendigten One-Tap-Pfad
// (use_fedcm_for_button: false), der in aktuellen Chromium-Versionen nichts
// mehr liefert.
//
// Diese Tests nageln die GIS-Konfiguration fest: auto_select UND
// moment_callback UND den FedCM-Pfad. Gegen den alten Stand schlagen sie fehl.

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, v); },
  } as Storage;
}

/** Baut einen JWT-artigen Token, dessen exp-Claim in der Zukunft liegt. */
function token(expMs: number): string {
  const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = enc({ exp: Math.floor(expMs / 1000), email: "a@b.c", name: "Ann" });
  return `${enc({ alg: "RS256", typ: "JWT" })}.${body}.sig`;
}

interface Cfg {
  auto_select?: boolean;
  moment_callback?: (m: unknown) => void;
  callback: (r: { credential?: string }) => void;
  use_fedcm_for_button?: boolean;
  itp_support?: boolean;
  client_id?: string;
}

const cfg = (): Cfg => gsiConfig() as unknown as Cfg;

describe("GIS-Konfiguration: stiller Refresh muss verdrahtet sein", () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = memStorage();
    (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = memStorage();
    (globalThis as unknown as { window: unknown }).window = {};
    signOut();
  });

  it("uebergibt moment_callback neben auto_select (sonst kein stiller Refresh)", () => {
    const c = cfg();
    expect(c.auto_select).toBe(true);
    // Der eigentliche Bug: dieser Callback fehlte.
    expect(typeof c.moment_callback).toBe("function");
  });

  it("nutzt den FedCM-Button-Pfad statt des abgekuendigten One-Tap", () => {
    const c = cfg();
    expect(c.use_fedcm_for_button).toBe(true);
    expect(c.itp_support).toBe(true);
  });

  it("erneuert die Session still, wenn moment_callback ein Credential liefert", () => {
    const seen: string[] = [];
    onSessionRefresh((s) => seen.push(s.token));

    // Eine bestehende Session ist die Voraussetzung dafuer, dass GIS-Antworten
    // als Refresh (statt als Erst-Login) gelten.
    setSession({ token: "alt", exp: Date.now() + 3600_000 });

    const tok = token(Date.now() + 3600_000);
    // Legacy-Form: credential steht direkt in der Notification.
    cfg().moment_callback?.({ credential: tok });
    expect(seen.length).toBe(1);
    expect(seen[0]).toBe(tok);
    expect(localStorage.getItem(IDTOKEN_KEY)).toContain(tok);
  });

  it("holt das Credential aus einer FedCM-Notification", () => {
    const tok = token(Date.now() + 3600_000);
    expect(credentialFromNotification({ getCredentialResponse: () => ({ credential: tok }) })).toBe(tok);
  });

  it("gibt null zurueck, wenn die Notification nichts hergibt", () => {
    expect(credentialFromNotification({})).toBeNull();
    expect(credentialFromNotification({ getCredentialResponse: () => ({}) })).toBeNull();
  });

  it("uebernimmt ein Credential auch ueber den Login-Callback", () => {
    const tok = token(Date.now() + 3600_000);
    const seen: string[] = [];
    onSessionRefresh((s) => seen.push(s.token));
    // Ohne bestehende Session zaehlt die Antwort als Erst-Login, nicht als Refresh.
    cfg().callback({ credential: tok });
    expect(localStorage.getItem(IDTOKEN_KEY)).toContain(tok);
    expect(seen.length).toBe(0);
  });
});
