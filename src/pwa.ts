// PWA-Lifecycle: Service-Worker-Updates, Offline-Status, Installation,
// Speicher-Persistenz.
//
// Alles hier ist progressiv: fehlt eine API im Browser, passiert einfach
// nichts. Kein Feature darf das Spiel blockieren.

import { t } from "./i18n";
import { DISMISS_KEY } from "./storage/keys";

type Toast = (msg: string, actionLabel?: string, onAction?: () => void) => void;

let toastFn: Toast = () => { /* vor init() */
};

/** Zeigt eine kurze Einblendung; optional mit Aktionsknopf. */
function toast(msg: string, actionLabel?: string, onAction?: () => void): void {
  toastFn(msg, actionLabel, onAction);
}

// ---------------------------------------------------------------- Version
let currentVersion = "";

/** Build-Version aus /version.json (falls vorhanden). */
export async function fetchVersion(): Promise<string> {
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    if (!res.ok) return "";
    const data = await res.json();
    return typeof data.version === "string" ? data.version : "";
  } catch {
    return "";
  }
}

export function appVersion(): string {
  return currentVersion;
}

// ------------------------------------------------------- Service Worker
let waitingWorker: ServiceWorker | null = null;
let reloadRequested = false;

/** Registriert den SW und haengt sich in den Update-Zyklus.
 *  Neue Versionen werden NICHT automatisch aktiv – die Seite fragt. */
export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  currentVersion = await fetchVersion();

  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });

    // Läuft schon eine neue Version im Wartezustand?
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);

    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener("statechange", () => {
        // "installed" + vorhandener Controller = Update, kein Erstinstall.
        if (sw.state === "installed" && navigator.serviceWorker.controller) offerUpdate(sw);
      });
    });

    // Beim Zurückkehren in den Tab nach Updates sehen (max. 1×/Stunde).
    let lastCheck = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastCheck < 3_600_000) return;
      lastCheck = now;
      reg.update().catch(() => { /* egal */ });
    });

    // Stiller Check nach dem Start.
    reg.update().catch(() => { /* egal */ });
  } catch { /* SW nicht registrierbar (z. B. http) – Spiel läuft trotzdem */ }

  // Der neue SW hat übernommen -> jetzt sauber neu laden.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadRequested) return;
    reloadRequested = true;
    location.reload();
  });
}

function offerUpdate(worker: ServiceWorker): void {
  waitingWorker = worker;
  toast(t("updateReady"), t("updateReload"), () => {
    reloadRequested = true;
    waitingWorker?.postMessage({ type: "SKIP_WAITING" });
  });
}

// ----------------------------------------------------------- Offline-Status
export function initOfflineStatus(): void {
  const apply = () => {
    const off = !navigator.onLine;
    document.documentElement.classList.toggle("is-offline", off);
    const banner = document.getElementById("offline-banner");
    if (banner) banner.hidden = !off;
  };
  apply();
  window.addEventListener("online", apply);
  window.addEventListener("offline", apply);
}

// ------------------------------------------------------------- Installation
type InstallPrompt = { prompt(): void; userChoice: Promise<{ outcome: string }> };
let deferredPrompt: InstallPrompt | null = null;

/** Standalone (bereits installiert)? */
function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** iOS (Safari hat kein beforeinstallprompt). */
function isIos(): boolean {
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) &&
    !(window as unknown as { MSStream?: unknown }).MSStream
  );
}

export function initInstall(): void {
  if (isStandalone()) return; // schon installiert: kein Install-Prompt noetig

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as unknown as InstallPrompt;
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    toast(t("installed"));
  });

  // Hinweis beim zweiten Besuch – aber nur einmal und nur ohne Installation.
  maybeNudgeInstall();
}

/** Startet den Install-Dialog; auf iOS stattdessen die Anleitung. */
export async function promptInstall(): Promise<void> {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch { /* egal */ }
    deferredPrompt = null;
    return;
  }
  // Kein Prompt verfügbar: Anleitung zeigen (iOS oder schon installiert).
  showInstallHelp();
}

export function showInstallHelp(): void {
  const dialog = document.getElementById("install-help") as HTMLDialogElement | null;
  if (!dialog) return;
  const ios = document.getElementById("install-help-ios");
  const other = document.getElementById("install-help-other");
  if (ios) ios.hidden = !isIos();
  if (other) other.hidden = isIos();
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.hidden = false;
}

/** Nach dem zweiten Besuch einmalig freundlich an den Install erinnern. */
async function maybeNudgeInstall(): Promise<void> {
  if (isStandalone()) return;
  try {
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
  } catch { return; }

  const visits = await countVisits();
  if (visits < 2) return;

  // Erst zeigen, wenn die Seite ruhig ist.
  window.setTimeout(() => {
    const dialog = document.getElementById("install-help") as HTMLDialogElement | null;
    if (!dialog || isStandalone()) return;
    // Ohne echten Prompt (iOS/Firefox/Safari) direkt die Anleitung.
    if (!deferredPrompt) showInstallHelp();
  }, 20_000);
}

async function countVisits(): Promise<number> {
  const KEY = "tamagotchi.visits";
  try {
    const n = (Number(localStorage.getItem(KEY)) || 0) + 1;
    localStorage.setItem(KEY, String(n));
    return n;
  } catch {
    return 0;
  }
}

export function dismissInstall(): void {
  try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* egal */ }
  const dialog = document.getElementById("install-help") as HTMLDialogElement | null;
  if (dialog?.open) dialog.close();
  else if (dialog) dialog.hidden = true;
}

// ------------------------------------------------------- Speicher-Persistenz
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageInfo(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    const persisted = (await navigator.storage.persisted?.()) ?? false;
    return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------- Wake Lock
/** Bittet den SW, den Cloud-Sync nachzuholen, sobald wieder Netz da ist. */
export async function requestBackgroundSync(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("SyncManager" in window)) return false;
  try {
    const reg = (await navigator.serviceWorker.ready) as unknown as {
      sync?: { register(tag: string): Promise<void> };
    };
    await reg.sync?.register("tamagotchi-sync");
    return true;
  } catch {
    return false;
  }
}

/** Lauscht auf Sync-Anforderungen aus dem Service Worker. */
export function onBackgroundSync(handler: () => void): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "SYNC_REQUESTED") handler();
  });
}

// ------------------------------------------------------------------ Init
export function initPwa(opts: { toast: Toast }): void {
  toastFn = opts.toast;
  initOfflineStatus();
  initInstall();

  // Persistenz einmal anfragen – schützt den Spielstand vor Räumung.
  void requestPersistentStorage();

  document.getElementById("install-help-dismiss")?.addEventListener("click", dismissInstall);
  document.getElementById("install-help-close")?.addEventListener("click", dismissInstall);
  document.getElementById("install-help")?.addEventListener("cancel", dismissInstall);
}
