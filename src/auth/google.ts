// Google Identity Services: Button rendern, ID-Token holen, Session halten.
// Ohne GOOGLE_CLIENT_ID passiert hier nichts (siehe config.ts).
import { GOOGLE_CLIENT_ID } from "./config";
import { currentLang } from "../i18n";

export interface Session {
  token: string;
  /** Ablauf in ms (epoch). */
  exp: number;
  email?: string;
  name?: string;
  picture?: string;
}

interface GsiId {
  initialize(cfg: { client_id: string; callback: (r: { credential?: string }) => void }): void;
  renderButton(el: HTMLElement, opts: Record<string, string | number>): void;
  disableAutoSelect?(): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GsiId } };
  }
}

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const STORE_KEY = "tamagotchi.idtoken";
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

/** Session aus sessionStorage wiederherstellen (nur wenn noch gültig). */
export function restoreSession(): Session | null {
  if (session) return session;
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s.token || s.exp - SKEW_MS <= Date.now()) {
      sessionStorage.removeItem(STORE_KEY);
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
    if (s) sessionStorage.setItem(STORE_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(STORE_KEY);
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
      theme: "filled_black",
      size: "large",
      shape: "rectangular",
      text: "continue_with",
      locale: currentLang(),
    });
    return true;
  } catch {
    return false;
  }
}
