// Google Identity Services: Button rendern, ID-Token holen, Session halten.
// Ohne GOOGLE_CLIENT_ID passiert hier nichts (siehe config.ts).
import { GOOGLE_CLIENT_ID } from "./config";
import { currentLang } from "../i18n";
import { IDTOKEN_KEY } from "../storage/keys";

export interface Session {
  token: string;
  /** Ablauf in ms (epoch). */
  exp: number;
  email?: string;
  name?: string;
  picture?: string;
}

/**
 * Was GIS ueber moment_callback meldet. Zwei Formen:
 *  - FedCM: eine Notification, aus der man das Credential aktiv holen muss.
 *  - Legacy: direkt eine Antwort mit `credential` (Silent-Refresh).
 * Beide Wege muessen behandelt werden; sonst verpufft der stille Refresh.
 */
interface GsiNotification {
  getCredentialResponse?: () => { credential?: string };
  isDisplayMoment?: () => boolean;
  isDisplayed?: () => boolean;
  isNotDisplayed?: () => boolean;
  getNotDisplayedReason?: () => string;
  getSkippedReason?: () => string;
  getDismissedReason?: () => string;
  credential?: string;
}

interface GsiId {
  initialize(cfg: {
    client_id: string;
    callback: (r: { credential?: string }) => void;
    /** Pflicht, sobald auto_select gesetzt ist (siehe initGsi). */
    auto_select?: boolean;
    /** Zwingend neben auto_select: ohne moment_callback schaltet GIS den
     *  stillen Pfad komplett ab - der Button bleibt dann wirkungslos. */
    moment_callback?: (m: GsiNotification) => void;
    /** FedCM statt des abgekuendigten One-Tap-Iframes (Pflicht in Chromium 14x). */
    use_fedcm_for_button?: boolean;
    /** Bessere Chancen auf den stillen Refresh trotz Tracking-Schutz. */
    itp_support?: boolean;
    /** Kein erneutes Einblenden von UI waehrend der stillen Erneuerung. */
    cancel_on_tap_outside?: boolean;
  }): void;
  renderButton(el: HTMLElement, opts: Record<string, string | number>): void;
  disableAutoSelect?(): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GsiId } };
  }
}

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";
/** Alter Schluessel aus der Zeit, als die Session in sessionStorage lag. */
const LEGACY_KEY = "tamagotchi.idtoken";
const SKEW_MS = 60_000; // 1 min Puffer

let session: Session | null = null;
let loader: Promise<GsiId> | null = null;
/** Laeuft der GIS-Init schon? initialize genau EINMAL mit gemeinsamem Callback. */
let gsiInit: Promise<GsiId | null> | null = null;
/** Zu rufen bei einem *neuen* Login (frische Anmeldung ueber den Button). */
const loginListeners = new Set<(s: Session) => void>();
/** Zu rufen bei einem stillen Token-Refresh (Silent-Refresh). */
const refreshListeners = new Set<(s: Session) => void>();

/** Bei einem still erneuerten Token benachrichtigen (z. B. fuer die UI). */
export function onSessionRefresh(cb: (s: Session) => void): () => void {
  refreshListeners.add(cb);
  return () => refreshListeners.delete(cb);
}

function decodePayload(token: string): { exp?: number; email?: string; name?: string; picture?: string } {
  try {
    const part = token.split(".")[1] ?? "";
    const pad = part.length % 4 === 0 ? "" : "=".repeat(4 - (part.length % 4));
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/") + pad);
    return JSON.parse(json) as { exp?: number; email?: string; name?: string; picture?: string };
  } catch {
    return {};
  }
}

function toSession(token: string): Session | null {
  const p = decodePayload(token);
  if (!p.exp) return null;
  return { token, exp: p.exp * 1000, email: p.email, name: p.name, picture: p.picture };
}

function loadScript(): Promise<GsiId> {
  if (loader) return loader;
  loader = new Promise<GsiId>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SCRIPT_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => {
      const id = window.google?.accounts?.id;
      if (id) resolve(id);
      else reject(new Error("GIS nicht verfügbar"));
    };
    el.onerror = () => reject(new Error("GIS konnte nicht geladen werden"));
    document.head.appendChild(el);
  });
  return loader;
}

export interface RestoreOptions {
  /**
   * Nur setzen, wenn der stille Refresh tatsaechlich ein neues Token geliefert hat.
   *
   * Ein abgelaufenes Token ist der einzige Hinweis fuer GIS, dass ein Konto
   * hinterlegt war. Es darf erst weichen, wenn ein Ersatz da ist - sonst meldet
   * sich GIS nie und der Nutzer muss sich neu anmelden, obwohl die Google-Session
   * im Browser noch gilt.
   */
  replaceExpired?: boolean;
}

/**
 * Session wiederherstellen (nur wenn noch gueltig).
 *
 * Liegt in localStorage, damit die Anmeldung das Schliessen des Tabs ueberlebt.
 * (sessionStorage starb mit dem Tab - man musste sich jedes Mal neu anmelden.)
 * Die Gueltigkeit kommt aus der exp-Claim des ID-Tokens.
 *
 * Ein abgelaufenes Token bleibt liegen, bis ein Refresh-Ergebnis es ersetzt
 * (siehe RestoreOptions.replaceExpired).
 */
export function restoreSession(opts: RestoreOptions = {}): Session | null {
  if (session) return session;
  try {
    let raw = localStorage.getItem(IDTOKEN_KEY);
    if (!raw) {
      // Einmalige Migration: alten Eintrag aus sessionStorage uebernehmen.
      const legacy = sessionStorage.getItem(LEGACY_KEY);
      if (legacy) {
        localStorage.setItem(IDTOKEN_KEY, legacy);
        sessionStorage.removeItem(LEGACY_KEY);
        raw = legacy;
      }
    }
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s.token || s.exp - SKEW_MS <= Date.now()) {
      // Abgelaufen: liegen lassen, solange kein Ersatz da ist. GIS braucht den
      // Eintrag, um ueberhaupt zu wissen, dass ein Konto hinterlegt war.
      if (opts.replaceExpired) localStorage.removeItem(IDTOKEN_KEY);
      return null;
    }
    session = s;
    return s;
  } catch {
    return null;
  }
}

/**
 * Nur raeumen, wenn inzwischen wirklich ein gueltiges Token vorliegt.
 *
 * Wird aufgerufen, nachdem GIS ein Credential gemeldet hat (Silent-Refresh):
 * erst dann darf ein abgelaufener Eintrag fallen. Ein bloss initialisiertes GIS
 * ist noch kein Ersatz - genau daran scheiterte der Refresh vorher.
 */
export function discardExpiredIfReplaced(): void {
  if (session) return;
  const raw = localStorage.getItem(IDTOKEN_KEY);
  if (!raw) return;
  try {
    const s = JSON.parse(raw) as Session;
    if (s.exp - SKEW_MS <= Date.now()) return; // immer noch abgelaufen: behalten
    localStorage.removeItem(IDTOKEN_KEY);
  } catch {
    /* unlesbar: liegen lassen */
  }
}

export function currentSession(): Session | null {
  return session;
}

export function setSession(s: Session | null): void {
  session = s;
  try {
    if (s) localStorage.setItem(IDTOKEN_KEY, JSON.stringify(s));
    else localStorage.removeItem(IDTOKEN_KEY);
  } catch {
    /* ignorieren */
  }
}

export function signOut(): void {
  window.google?.accounts?.id?.disableAutoSelect?.();
  setSession(null);
}

/**
 * Ein eingetroffenes Token verarbeiten.
 *
 * Entscheidend ist die Unterscheidung "stiller Refresh" gegen "echter Login":
 * nur ein Refresh darf die Sync-Listener (und damit einen Cloud-Abgleich)
 * ausloesen, ein Login geht an die Aufrufer der UI.
 */
function acceptCredential(credential: string): void {
  const s = toSession(credential);
  if (!s) return;
  // Ersatz ist da: ein bis dahin liegen gelassenes, abgelaufenes Token darf weg.
  // (Reihenfolge zaehlt - erst setSession, sonst haelt discard das alte fuer aktuell.)
  const isRefresh = !!session;
  setSession(s);
  discardExpiredIfReplaced();
  if (isRefresh) for (const cb of refreshListeners) cb(s);
  else for (const cb of loginListeners) cb(s);
}

/**
 * Antwort aus einer GIS-Notification ziehen.
 *
 * FedCM meldet ueber moment_callback nur eine *Notification*; das Credential
 * muss man dort aktiv mit getCredentialResponse() abholen. Der Legacy-Pfad
 * legt `credential` dagegen direkt ins Objekt. Beide Formen kommen vor, je
 * nachdem ob use_fedcm_for_button greift.
 */
export function credentialFromNotification(m: GsiNotification): string | null {
  if (typeof m.credential === "string" && m.credential) return m.credential;
  if (typeof m.getCredentialResponse === "function") {
    try {
      const r = m.getCredentialResponse();
      if (r && typeof r.credential === "string" && r.credential) return r.credential;
    } catch {
      /* Notification war nicht (mehr) abholbar */
    }
  }
  return null;
}

/**
 * Initialisiert GIS einmalig inkl. Silent-Refresh.
 *
 * auto_select erneuert das ID-Token im Hintergrund, solange die Google-Session
 * im Browser noch gilt - der Nutzer bleibt also angemeldet, ohne sich nach
 * Ablauf des Tokens (~1 h) neu anmelden zu muessen.
 *
 * Wichtig: `auto_select` OHNE `moment_callback` ist wirkungslos. Google schaltet
 * den stillen Pfad dann ab; der Button rendert zwar, ein Klick loest aber nichts
 * aus (genau das war der Fehler: "ich muss mich jedes Mal neu anmelden"). Der
 * moment_callback traegt den stillen Refresh UND den Klickpfad des FedCM-Buttons.
 *
 * use_fedcm_for_button: true statt des abgekuendigten One-Tap-Iframes - Chromium
 * 14x behandelt den alten Pfad zunehmend als Legacy und liefert dort nichts mehr
 * aus. itp_support gibt dem stillen Refresh zusaetzliche Chancen.
 *
 * Grenze: Das klappt nur, wenn der Browser Cookies fuer accounts.google.com
 * zulaesst (3rd-Party-Cookie-Blockade kann es verhindern). Dann greift der
 * normale Anmelde-Button.
 */
/**
 * Die GIS-Konfiguration an einer Stelle - damit sie testbar und nachvollziehbar
 * bleibt. Wird von initGsi() an Googles initialize() uebergeben.
 *
 * `moment_callback` ist hier kein Extra, sondern Pflicht: zusammen mit
 * `auto_select` traegt er den stillen Token-Refresh UND den Klickpfad des
 * FedCM-Buttons. Ohne ihn liefert GIS nichts aus.
 */
export function gsiConfig(onCredential?: (credential: string) => void): Record<string, unknown> {
  const handle = (credential: string | null | undefined): void => {
    if (!credential) return;
    if (onCredential) onCredential(credential);
    else acceptCredential(credential);
  };
  return {
    client_id: GOOGLE_CLIENT_ID,
    auto_select: true,
    use_fedcm_for_button: true,
    itp_support: true,
    cancel_on_tap_outside: true,
    // Pflicht neben auto_select - traegt stillen Refresh und Button-Klick.
    moment_callback: (m: GsiNotification) => handle(credentialFromNotification(m)),
    callback: (res: { credential?: string }) => handle(res.credential),
  };
}

export async function initGsi(onSession: (s: Session) => void): Promise<GsiId | null> {
  // Registrierung sofort (falls der Init bereits laeuft und das Token schon da ist).
  loginListeners.add(onSession);
  if (gsiInit) return gsiInit;
  gsiInit = (async () => {
    try {
      const id = await loadScript();
      id.initialize(gsiConfig() as unknown as Parameters<GsiId["initialize"]>[0]);
      return id;
    } catch {
      gsiInit = null; // beim naechsten Versuch erneut probieren
      return null;
    }
  })();
  return gsiInit;
}

/**
 * Rendert Googles eigenen Button in `el`. Der Callback liefert das ID-Token.
 * Gibt zurück, ob das Rendern geklappt hat.
 */
export async function renderSignInButton(el: HTMLElement, onSession: (s: Session) => void): Promise<boolean> {
  try {
    const id = await initGsi(onSession);
    if (!id) return false;
    id.renderButton(el, {
      // Blauer Google-Button – ausdruecklicher Wunsch, passt zum Konto-Fenster.
      theme: "filled_blue",
      size: "large",
      shape: "rectangular",
      text: "signin_with",
      // Feste Breite: passt auch auf 320px-Geraeten und laesst dem laengeren
      // deutschen Text Platz (sonst schneidet Google den Label ab).
      width: 260,
      locale: currentLang(),
    });
    return true;
  } catch {
    return false;
  }
}
