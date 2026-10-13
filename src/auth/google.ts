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

interface GsiId {
  initialize(cfg: {
    client_id: string;
    callback: (r: { credential?: string }) => void;
    use_fedcm_for_button?: boolean;
    auto_select?: boolean;
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

/**
 * Session wiederherstellen (nur wenn noch gueltig).
 *
 * Liegt in localStorage, damit die Anmeldung das Schliessen des Tabs ueberlebt.
 * (sessionStorage starb mit dem Tab - man musste sich jedes Mal neu anmelden.)
 * Die Gueltigkeit kommt aus der exp-Claim des ID-Tokens.
 */
export function restoreSession(): Session | null {
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
      localStorage.removeItem(IDTOKEN_KEY);
      return null;
    }
    session = s;
    return s;
  } catch {
    return null;
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
 * Rendert Googles eigenen Button in `el`. Der Callback liefert das ID-Token.
 * Gibt zurück, ob das Rendern geklappt hat.
 */
export async function renderSignInButton(el: HTMLElement, onSession: (s: Session) => void): Promise<boolean> {
  try {
    const id = await loadScript();
    id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      // Kein FedCM: dann oeffnet Google den klassischen Dialog im eigenen Fenster
      // statt des weissen "Als … fortfahren"-Waehlers mitten in unserer Seite.
      use_fedcm_for_button: false,
      auto_select: false,
      callback: (res) => {
        if (!res.credential) return;
        const s = toSession(res.credential);
        if (s) {
          setSession(s);
          onSession(s);
        }
      },
    });
    id.renderButton(el, {
      // Googles Standard-Optik (hell, farbiges G) – ausdruecklicher Wunsch.
      theme: "outline",
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
