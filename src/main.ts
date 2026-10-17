import { DEVICES, pickInitialDevice, nextDevice, switchLabel, type Device } from "./emu/devices";
import { LCD_WIDTH, LCD_HEIGHT, type Btn } from "./emu/constants";
import { drawLcd } from "./render/lcd";
import { drawIconRow, loadIcons, renderIconGrid, type IconImages } from "./render/icons";
import { handleKey, BUTTON_MAP, type LogicalButton } from "./emu/input";
import { createPiezo } from "./emu/audio";
import { LiveClient } from "./net/live";
import { AUTH_ENABLED } from "./auth/config";
import { currentSession, restoreSession, renderSignInButton, signOut, initGsi, onSessionRefresh, type Session } from "./auth/google";
import { SHELLS, applyShell, savedShell, starPolygon, type Shell } from "./shell";
import { buildGrass } from "./grass";
import { applyI18n, currentLang, iconNames, t } from "./i18n";
import { THEMES, BG_KEY, AUTO, savedBg, resolveTheme } from "./theme";
import { SOUND_KEY, NOTIFY_KEY, DEVICE_KEY } from "./storage/keys";
import { createPetsView, type PetSummary } from "./ui/pets";
import { createBootOverlay } from "./ui/boot";
import { createSlotsView } from "./ui/slots";
import { createSettingsView, type Settings } from "./ui/settings";
import { createAppearanceHandlers } from "./ui/appearance";
import { createBeepsView, type BeepSummary } from "./ui/beeps";
import { api } from "./ui/api";
import {
  initPwa,
  registerServiceWorker,
  fetchVersion,
  storageInfo,
} from "./pwa";

const canvas = document.getElementById("lcd") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const iconsTop = document.getElementById("icons-top") as HTMLCanvasElement;
const iconsBottom = document.getElementById("icons-bottom") as HTMLCanvasElement;
const ctxTop = iconsTop.getContext("2d")!;
const ctxBottom = iconsBottom.getContext("2d")!;

// Echte P1-Icon-Grafiken; nach loadIcons befuellt. Leer = noch nicht geladen.
let iconImgs: IconImages = [];

// Mini-Vorschau im Menü
let miniDevice: HTMLElement | null = null;
let miniWrapEl: HTMLElement | null = null;
let miniLcd: HTMLCanvasElement | null = null;
let miniLcdCtx: CanvasRenderingContext2D | null = null;
let miniTop: HTMLCanvasElement | null = null;
let miniBottom: HTMLCanvasElement | null = null;
let miniTopCtx: CanvasRenderingContext2D | null = null;
let miniBottomCtx: CanvasRenderingContext2D | null = null;
/** Icon-Canvas der Vorschau-Karten (Karussell): je Karte [oben, unten]. */
const miniIconCanvases: { top: HTMLCanvasElement; bottom: HTMLCanvasElement }[] = [];

/**
 * Zeichnet die P1-Icon-Reihen in jede Vorschau-Karte (nach loadIcons). Die
 * Vorschau zeigt keinen laufenden Emulator, daher leerer Icon-Zustand (alle
 * Segmente dezent) – aber aus den echten P1-Sprites, nicht mehr hartkodiert.
 */
function paintMiniIcons(): void {
  const ms = 2; // 32x8 logisch -> 64x16 px
  const blank = new Uint8Array(8);
  for (const { top, bottom } of miniIconCanvases) {
    for (const [cv, row] of [[top, 0], [bottom, 1]] as const) {
      const c = cv.getContext("2d");
      if (!c) continue;
      cv.width = LCD_WIDTH * ms;
      cv.height = 8 * ms;
      drawIconRow(c, blank, row, ms, iconImgs);
    }
  }
}

const piezo = createPiezo(() => new AudioContext());
const menuEl = document.getElementById("menu");

// Service Worker registrieren (ausgelagert, damit kein Inline-Script nötig ist → strikte CSP).
// Updates werden nicht mehr still uebernommen: der neue SW wartet, die Seite
// bietet einen Reload an (siehe src/pwa.ts).
void registerServiceWorker();

const params = new URLSearchParams(location.search);
const shellParam = params.get("shell");
/** Manifest-Shortcut "How to play" oeffnet direkt die Anleitung. */
const openGuideOnBoot = params.get("guide") === "1";

// ---- Hintergrund-Themes (Definition in src/theme.ts) ----
// "auto" wählt nach Tageszeit; gespeichert wird die Auswahl, angezeigt das Theme.
let selectedBg = "day";

/**
 * True, solange `applyServerSettings()` geladene Werte in die UI schreibt. In
 * diesem Fenster stammen Theme-/Shell-Wechsel vom Server, nicht vom Nutzer, und
 * dürfen nicht zurückgeschrieben werden (sonst Schleife bzw. Überschreiben der
 * Wahl eines anderen Geräts).
 */
let applyingFromServer = false;

/**
 * Theme/Shell-Auswahl persistieren (Fix A2b, Task-11 D2). Die Handler werden vom
 * Theme-Grid, dem Shell-Grid und dem Shell-Karussell gerufen. `isApplying`
 * entschärft den Rückweg: Werte, die `applyServerSettings` gerade in die UI
 * schreibt, werden nicht erneut gespeichert. `persistSetting` ist eine gehoistete
 * Funktionsdeklaration weiter unten, daher hier bereits sicher referenzierbar.
 */
const appearance = createAppearanceHandlers({
  persist: (patch) => persistSetting(patch),
  isApplying: () => applyingFromServer,
});

// Kurzes Crossfade beim Umschalten: den alten Hintergrund als Layer darüberlegen
// und ausblenden, sobald das neue Theme steht. Bei reduced motion: kein Fade.
function withFade(mutate: () => void): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { mutate(); return; }
  const cs = getComputedStyle(document.body);
  const blobs = cs.getPropertyValue("--blobs").trim();
  const grad = cs.backgroundImage === "none" ? "" : cs.backgroundImage;
  const wash = document.createElement("div");
  wash.className = "theme-fade";
  wash.setAttribute("aria-hidden", "true");
  wash.style.backgroundColor = cs.backgroundColor;
  wash.style.backgroundImage = blobs ? (grad ? `${blobs}, ${grad}` : blobs) : grad;
  wash.style.setProperty("--motif", cs.getPropertyValue("--motif"));
  document.body.appendChild(wash);
  mutate();
  window.setTimeout(() => wash.remove(), 460);
}

function applyBg(id: string, animate = true): void {
  const commit = (): void => {
    selectedBg = id;
    document.body.dataset.bg = resolveTheme(id);
    try { localStorage.setItem(BG_KEY, id); } catch { /* ignore */ }
    document.querySelectorAll<HTMLElement>(".bgbtn").forEach((el) => {
      el.classList.toggle("active", el.dataset.id === id);
    });
    const g = document.getElementById("grass");
    if (g) buildGrass(g);
  };
  if (animate) withFade(commit); else commit();
}

// Bei "auto" das Theme mit der Tageszeit mitführen (nur bei Wechsel neu anwenden).
setInterval(() => {
  if (selectedBg !== AUTO) return;
  if (document.body.dataset.bg !== resolveTheme(AUTO)) applyBg(AUTO);
}, 60_000);

// ---- Benachrichtigungen ----
let notifyEnabled = false;
try { notifyEnabled = localStorage.getItem(NOTIFY_KEY) === "1"; } catch { /* ignore */ }
let lastNotify = 0;

// ---- Sound ----
let soundOn = true;
try { soundOn = localStorage.getItem(SOUND_KEY) !== "0"; } catch { /* ignore */ }
function updateSoundLabel(): void {
  const el = document.getElementById("sound-state");
  if (el) el.textContent = t(soundOn ? "on" : "off");
  document.getElementById("btn-sound")?.setAttribute("aria-pressed", String(soundOn));
}

// ---- Toast: kurze Einblendungen (Update-Hinweis, Installations-Feedback) ----
let toastTimer = 0;
function showToast(msg: string, actionLabel?: string, onAction?: () => void): void {
  const el = document.getElementById("toast");
  if (!el) return;
  const msgEl = document.getElementById("toast-msg");
  const actionEl = document.getElementById("toast-action") as HTMLButtonElement | null;
  if (msgEl) msgEl.textContent = msg;
  if (actionEl) {
    if (actionLabel && onAction) {
      actionEl.hidden = false;
      actionEl.textContent = actionLabel;
      actionEl.onclick = () => { hideToast(); onAction(); };
    } else {
      actionEl.hidden = true;
      actionEl.onclick = null;
    }
  }
  el.hidden = false;
  window.clearTimeout(toastTimer);
  // Mit Aktion bleibt er laenger stehen - der Nutzer soll reagieren koennen.
  toastTimer = window.setTimeout(hideToast, actionLabel ? 12_000 : 5_000);
}
function hideToast(): void {
  const el = document.getElementById("toast");
  if (el) el.hidden = true;
  window.clearTimeout(toastTimer);
}
document.getElementById("toast-close")?.addEventListener("click", hideToast);

function updateNotifyLabel(): void {
  const el = document.getElementById("notify-state");
  if (el) el.textContent = t(notifyEnabled ? "on" : "off");
  document.getElementById("btn-notify")?.setAttribute("aria-pressed", String(notifyEnabled));
}

async function notify(title: string, body: string): Promise<void> {
  if (!notifyEnabled || !("Notification" in window) || Notification.permission !== "granted") return;
  const now = Date.now();
  if (now - lastNotify < 60_000) return;
  lastNotify = now;
  const opts: NotificationOptions = { body, icon: "/icons/icon-192-v2.png", badge: "/icons/icon-192-v2.png", tag: "tamagotchi" };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { ...opts, body });
    else new Notification(title, { ...opts, body });
  } catch { /* ignore */ }
}

// ---- Hintergrund-Themes ----
function initUI(): void {
  const bgbtns = document.getElementById("bgbtns");
  if (bgbtns) {
    for (const t of THEMES) {
      const item = document.createElement("div");
      item.className = "shell-item";
      const b = document.createElement("button");
      b.className = "bgbtn";
      b.dataset.id = t.id;
      b.title = t.id;
      b.style.background = t.c;
      b.setAttribute("aria-label", "Background: " + t.id);
      b.addEventListener("click", () => { applyBg(t.id); appearance.selectTheme(t.id); });
      if (t.id === AUTO) {
        const mark = document.createElement("span");
        mark.className = "bgbtn-a";
        mark.textContent = "Auto";
        mark.setAttribute("aria-hidden", "true");
        b.append(mark);
      }
      const label = document.createElement("span");
      label.textContent = t.id.charAt(0).toUpperCase() + t.id.slice(1);
      item.append(b, label);
      bgbtns.appendChild(item);
    }
    applyBg(savedBg(localStorage), false);
  }

  const shellbtns = document.getElementById("shellbtns");
  const deviceEl = document.querySelector(".device-wrap") as HTMLElement | null;
  const shellStage = document.getElementById("shell-stage");
  const deviceSrc = document.getElementById("device");
  if (shellStage && deviceSrc) {
    const clone = deviceSrc.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    clone.querySelectorAll("[id]").forEach((e) => e.removeAttribute("id"));
    clone.classList.add("mini-device");
    // Eigener Stern-Verlauf, damit die Vorschau ihre eigene Shell-Farbe nutzt.
    const grad = clone.querySelector("linearGradient");
    if (grad) {
      grad.setAttribute("id", "sun-mini");
      clone.querySelector("polygon")?.setAttribute("fill", "url(#sun-mini)");
    }
    // Öse (Ring) über der Vorschau – ohne Kette.
    const wrap = document.createElement("div");
    wrap.className = "mini-wrap";
    const ring = document.createElement("span");
    ring.className = "mini-ring";
    wrap.append(ring, clone);
    shellStage.appendChild(wrap);
    miniDevice = clone;
    miniWrapEl = wrap;
    const cvs = clone.querySelectorAll("canvas");
    miniTop = cvs[0] ?? null;
    miniLcd = cvs[1] ?? null;
    miniBottom = cvs[2] ?? null;
    miniTopCtx = miniTop ? miniTop.getContext("2d") : null;
    miniLcdCtx = miniLcd ? miniLcd.getContext("2d") : null;
    miniBottomCtx = miniBottom ? miniBottom.getContext("2d") : null;
  }
  if (shellbtns && deviceEl) {
    const setShell = (id: string, animate = true) => {
      const commit = (): void => {
        applyShell(deviceEl, id, localStorage);
        if (miniDevice) miniDevice.dataset.shell = id;
        if (miniWrapEl) miniWrapEl.dataset.shell = id;
        const shape = SHELLS.find((s) => s.id === id)?.star;
        if (shape) {
          const pts = starPolygon(shape);
          deviceEl.querySelector("svg.star polygon")?.setAttribute("points", pts);
          miniWrapEl?.querySelector("svg.star polygon")?.setAttribute("points", pts);
        }
        document.querySelectorAll<HTMLElement>(".shellbtn").forEach((el) => el.classList.toggle("active", el.dataset.id === id));
      };
      if (animate) withFade(commit); else commit();
    };
    for (const s of SHELLS) {
      const item = document.createElement("div");
      item.className = "shell-item";
      const b = document.createElement("button");
      b.className = "shellbtn";
      b.dataset.id = s.id;
      b.title = s.id;
      b.style.background = `linear-gradient(180deg, ${s.top}, ${s.bot})`;
      b.setAttribute("aria-label", "Shell: " + s.id);
      b.addEventListener("click", () => { setShell(s.id); appearance.selectShell(s.id); });
      const label = document.createElement("span");
      label.textContent = s.id.charAt(0).toUpperCase() + s.id.slice(1);
      item.append(b, label);
      shellbtns.appendChild(item);
    }
    const initial = shellParam && SHELLS.some((s) => s.id === shellParam) ? shellParam : savedShell(localStorage);
    setShell(initial, false);
  }

  // ---- Shell-Karussell (vertikal, endlos) ----
  const deviceEl2 = document.querySelector(".device-wrap") as HTMLElement | null;
  const carousel = document.getElementById("shell-carousel");
  if (deviceEl2 && carousel) {
    const N = SHELLS.length;
    const cards: HTMLButtonElement[] = [];
    const itemW = (): number => (cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft : 106);
    const centerOf = (card: HTMLElement): number => card.offsetLeft - (carousel.clientWidth - card.offsetWidth) / 2;

    const makeCard = (shell: Shell): HTMLButtonElement => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "shell-card";
      card.dataset.shell = shell.id;
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", "false");
      card.setAttribute("aria-label", "Shell: " + shell.id);
      const wrap = document.createElement("span");
      wrap.className = "mini-wrap";
      const ring = document.createElement("span");
      ring.className = "mini-ring";
      const dev = document.createElement("span");
      dev.className = "device";
      dev.dataset.shell = shell.id;
      dev.innerHTML =
        `<span class="mini-screen-wrap">` +
        `<svg class="mini-star" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">` +
        `<defs><linearGradient id="sun-${shell.id}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" class="sun-1" /><stop offset="0.5" class="sun-2" /><stop offset="1" class="sun-3" />` +
        `</linearGradient></defs>` +
        `<polygon points="${starPolygon(shell.star)}" fill="url(#sun-${shell.id})" /></svg>` +
        `<span class="mini-screen-stack">` +
        `<canvas class="mini-icons" width="32" height="8" aria-hidden="true"></canvas>` +
        `<span class="mini-screen"></span>` +
        `<canvas class="mini-icons" width="32" height="8" aria-hidden="true"></canvas>` +
        `</span>` +
        `</span>`;
      wrap.append(ring, dev);
      const ics = dev.querySelectorAll<HTMLCanvasElement>(".mini-icons");
      if (ics.length >= 2) miniIconCanvases.push({ top: ics[0], bottom: ics[1] });
      const name = document.createElement("span");
      name.className = "shell-name";
      name.textContent = shell.id.charAt(0).toUpperCase() + shell.id.slice(1);
      card.append(wrap, name);
      return card;
    };

    let current = "";
    const markCards = (): void => {
      carousel.querySelectorAll<HTMLElement>(".shell-card").forEach((el) => {
        // Klone niemals als ausgewaehlt markieren (sonst doppelte Auswahl).
        const sel = !el.dataset.clone && el.dataset.shell === current;
        el.setAttribute("aria-selected", String(sel));
      });
    };
    // Kein Puls mehr: die Auswahl greift sofort (Deckkraft) statt einer traegen
    // 320ms-Animation am Geraet.
    const pickShell = (id: string): void => {
      current = id;
      applyShell(deviceEl2, id, localStorage);
      const shape = SHELLS.find((s) => s.id === id)?.star;
      if (shape) deviceEl2.querySelector("svg.star polygon")?.setAttribute("points", starPolygon(shape));
      markCards();
    };

    // Endlos braucht mindestens 3 Saetze: der nutzbare Scrollweg muss groesser
    // als 2 Satzbreiten sein, sonst laesst sich nicht nahtlos umlaufen. Wir bauen
    // daher 3 volle Saetze (der mittlere ist der sichtbare Arbeitsbereich) und
    // spiegeln beim Sprung um genau eine Satzbreite. Die Performance kommt aus
    // den uebrigen Massnahmen (kein Puls, rAF, frische Messung, contain).
    for (let set = 0; set < 3; set++) {
      for (const sh of SHELLS) {
        const c = makeCard(sh);
        if (set !== 1) { c.dataset.clone = "1"; c.setAttribute("aria-hidden", "true"); c.tabIndex = -1; }
        cards.push(c);
      }
    }
    const track = document.createElement("span");
    track.className = "shell-track";
    track.append(...cards);
    carousel.replaceChildren(track);

    const initial = shellParam && SHELLS.some((s) => s.id === shellParam) ? shellParam : savedShell(localStorage);
    const idx = Math.max(0, SHELLS.findIndex((s) => s.id === initial));
    // Das Menue ist beim Aufbau versteckt (display:none) – dann sind clientWidth
    // und offsetLeft 0, ein Scrollen ist unmoeglich. Startposition und Highlight
    // daher erst setzen, wenn das Menue sichtbar ist UND das Layout steht (rAF).
    const menuEl = document.getElementById("menu");
    let posSet = false;
    const startIndex = N + idx;
    const placeOnce = (): void => {
      if (posSet || !menuEl || menuEl.hidden) return;
      requestAnimationFrame(() => {
        if (posSet || menuEl.hidden) return;
        posSet = true;
        if (cards[startIndex]) carousel.scrollLeft = centerOf(cards[startIndex]);
        measure();
        // Auswahl anhand der (jetzt gueltigen) Position markieren.
        const card = cards[centeredIndex()];
        if (card && card.dataset.shell) current = card.dataset.shell;
        markCards();
      });
    };
    if (menuEl) new MutationObserver(placeOnce).observe(menuEl, { attributes: true, attributeFilter: ["hidden"] });
    placeOnce();
    pickShell(initial);

    // Endlos: nur EIN Set + Klone. Wird der linke Klon erreicht, springen wir
    // um eine Satzbreite nach rechts (auf das Original), und umgekehrt.
    let scrollRaf = 0;
    let cardGeo: { left: number; width: number }[] = [];

    function measure(): void {
      cardGeo = cards.map((c) => ({ left: c.offsetLeft, width: c.offsetWidth }));
    }

    // Welche Karte liegt in der Mitte? Frisch gemessen (einmal pro Frame ist
    // guenstig und immer korrekt; ein Cache veraltete und verschob die Auswahl).
    const centeredIndex = (): number => {
      measure();
      const mid = carousel.scrollLeft + carousel.clientWidth / 2;
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let i = 0; i < cardGeo.length; i++) {
        const d = Math.abs(cardGeo[i].left + cardGeo[i].width / 2 - mid);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    };

    // Endlos (3 Saetze): Wir halten uns im mittleren Satz auf (Karten N..2N-1).
    // Laeuft die zentrierte Karte in den linken/rechten Satz, springen wir um
    // genau eine Satzbreite (itemW * N) zurueck in die Mitte. Beide Richtungen
    // sind damit nahtlos, weil der Scrollweg > 2 Satzbreiten ist.
    const applyScroll = (): void => {
      scrollRaf = 0;
      let i = centeredIndex();
      const step = itemW() * N;
      if (i < N) {
        carousel.scrollLeft += step;
        measure();
        i = centeredIndex();
      } else if (i >= 2 * N) {
        carousel.scrollLeft -= step;
        measure();
        i = centeredIndex();
      }
      const sel = cards[i];
      if (sel && sel.dataset.shell && sel.dataset.shell !== current) {
        pickShell(sel.dataset.shell);
        appearance.selectShell(sel.dataset.shell);
      } else markCards();
    };

    carousel.addEventListener("scroll", () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(applyScroll);
    }, { passive: true });
    window.addEventListener("resize", measure);
    for (const card of cards) {
      card.addEventListener("click", () => {
        carousel.scrollTo({ left: centerOf(card), behavior: "smooth" });
      });
    }

    // Maus-Ziehen (Desktop): Touch scrollt nativ, mit der Maus hilft nur Shift.
    let dragging = false;
    let dragStartX = 0;
    let dragStartLeft = 0;
    carousel.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      dragging = true;
      dragStartX = e.clientX;
      dragStartLeft = carousel.scrollLeft;
      carousel.classList.add("is-dragging");
      try { carousel.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    carousel.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      carousel.scrollLeft = dragStartLeft - (e.clientX - dragStartX);
    });
    const endDrag = (e: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      carousel.classList.remove("is-dragging");
      try { carousel.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      const card = cards[centeredIndex()];
      if (card) carousel.scrollTo({ left: centerOf(card), behavior: "smooth" });
    };
    carousel.addEventListener("pointerup", endDrag);
    carousel.addEventListener("pointercancel", endDrag);
  }

  const menu = document.getElementById("menu");
  const menuBtn = document.getElementById("btn-menu");
  const scrim = document.getElementById("scrim");
  const closeMenu = () => {
    if (menu) menu.hidden = true;
    if (scrim) scrim.hidden = true;
    menuBtn?.setAttribute("aria-expanded", "false");
    menuBtn?.focus();
  };
  const openMenu = () => {
    if (menu) menu.hidden = false;
    if (scrim) scrim.hidden = false;
    menuBtn?.setAttribute("aria-expanded", "true");
    document.getElementById("menu-close")?.focus();
  };
  document.getElementById("menu-close")?.addEventListener("click", closeMenu);
  scrim?.addEventListener("click", () => {
    // Wenn ein anderes Fenster offen ist, gehoert der Klick ihm.
    const acc = document.getElementById("account-pop");
    const gui = document.getElementById("guide-modal");
    if (acc && !acc.hidden) return;
    if (gui && !gui.hidden) return;
    closeMenu();
  });
  menuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!menu) return;
    if (menu.hidden) openMenu(); else closeMenu();
  });
  document.addEventListener("click", (e) => {
    if (menu && !menu.hidden && e.target instanceof Node && !menu.contains(e.target) && e.target !== menuBtn) closeMenu();
  });

  const modal = document.getElementById("modal");
  document.getElementById("btn-reset")?.addEventListener("click", () => { closeMenu(); if (modal) modal.hidden = false; });
  document.getElementById("btn-cancel")?.addEventListener("click", () => { if (modal) modal.hidden = true; document.getElementById("btn-menu")?.focus(); });
  modal?.addEventListener("click", (e) => { if (e.target === modal) { modal.hidden = true; document.getElementById("btn-menu")?.focus(); } });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenu();
      if (modal) modal.hidden = true;
      const am = document.getElementById("account-modal");
      if (am) am.hidden = true;
    }
  });

  // Fokus im Dialog halten (Tab zyklisch) – Menü und Modal.
  const focusables = (root: HTMLElement): HTMLElement[] =>
    [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]):not([hidden]), input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
  const trap = (root: HTMLElement | null, e: KeyboardEvent): void => {
    if (!root || e.key !== "Tab") return;
    const list = focusables(root);
    if (list.length === 0) return;
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  window.addEventListener("keydown", (e) => {
    if (modal && !modal.hidden) trap(modal.querySelector(".card"), e);
    else if (menu && !menu.hidden) trap(menu, e);
  });
  document.getElementById("btn-confirm-reset")?.addEventListener("click", () => {
    // Der Spielstand liegt auf dem Server; ein lokaler Reset raeumt nur noch die
    // Geraetewahl und startet die Ansicht neu.
    location.reload();
  });

  // ---- Benachrichtigungen ----
  updateNotifyLabel();
  // ---- Sound ----
  updateSoundLabel();
  piezo.setMuted(!soundOn);
  document.getElementById("btn-sound")?.addEventListener("click", () => {
    soundOn = !soundOn;
    try { localStorage.setItem(SOUND_KEY, soundOn ? "1" : "0"); } catch { /* ignore */ }
    piezo.setMuted(!soundOn);
    updateSoundLabel();
    persistSetting({ sound: soundOn });
  });

  document.getElementById("btn-notify")?.addEventListener("click", async () => {
    if (notifyEnabled) {
      notifyEnabled = false;
      try { localStorage.setItem(NOTIFY_KEY, "0"); } catch { /* ignore */ }
      updateNotifyLabel();
      persistSetting({ push: false });
      return;
    }
    if (!("Notification" in window)) return;
    try {
      const perm = await Notification.requestPermission();
      notifyEnabled = perm === "granted";
      try { localStorage.setItem(NOTIFY_KEY, notifyEnabled ? "1" : "0"); } catch { /* ignore */ }
    } catch { notifyEnabled = false; }
    updateNotifyLabel();
    persistSetting({ push: notifyEnabled });
  });

  // ---- i18n (Sprache folgt der Browsersprache) ----
  applyI18n();
  document.documentElement.lang = currentLang();

  // ---- Install-Hinweis (PWA) ----
  // Das Menue hat keinen Install-Knopf mehr; die Install-Anleitung (src/pwa.ts,
  // initInstall) bleibt einrichtungsseitig bestehen.

  // ---- Version im Footer ----
  // Direkt holen statt aus dem SW-Register: dessen Registrierung laeuft parallel,
  // die Versionsdatei waere hier sonst oft noch nicht gelesen.
  const verEl = document.getElementById("footer-version");
  const verDot = document.getElementById("footer-version-dot");
  void fetchVersion().then((ver) => {
    if (!verEl || !ver) return;
    verEl.textContent = `${t("version")} ${ver}`;
    verEl.hidden = false;
    if (verDot) verDot.hidden = false;
  });

  // Konto (nur wenn eine Client-ID hinterlegt ist)
  initAccount();
  initGuideDialog();
  initDeviceSwitch();
  // Manifest-Shortcut: ?guide=1 oeffnet die Anleitung direkt.
  if (openGuideOnBoot) window.setTimeout(() => document.getElementById("btn-guide")?.click(), 300);

  // Gras am Boden
  const grassEl = document.getElementById("grass");
  if (grassEl) {
    buildGrass(grassEl);
    let rt: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener("resize", () => {
      if (rt) clearTimeout(rt);
      rt = setTimeout(() => buildGrass(grassEl), 250);
    });
  }
}
initUI();

// ---- Live-Kanal: das Tier laeuft auf dem Server, der Tab ist Fenster + Fernbedienung ----
//
// Der in-tab-Emulator ist weg. Der Browser haengt an einem WebSocket (`/ws`),
// empfaengt LCD-Frames und schickt Tastendruecke zurueck. Faellt die Verbindung
// aus, laeuft das Tier serverseitig weiter - der Tab zeigt es nur nicht.
const live = new LiveClient();

/** Ist der P1/P2-Schalter bedienbar? (ROM-/Tier-Verfuegbarkeit serverseitig.) */
let p2Available = true;
/** Welches Geraet der Nutzer gerade bedient. */
let active: Device = "p1";
/** Letzter empfangener LCD-Frame (oder null, solange nichts kam). */
let lastFrame: Uint8Array | null = null;
/** Letzter empfangener Icon-Segment-Zustand (8 Bits, aus dem Live-Frame). */
let lastIcons: Uint8Array = new Uint8Array(8);
/**
 * Letzter empfangener Piezo-Zustand aus `{t:"buzzer"}`. `freq` in den rohen
 * ROM-Einheiten (0 = still), `on` das Enable-Flag. Wird pro Zeichenframe an den
 * Piezo gegeben (die Umrechnung macht `emu/audio.ts`, wie im alten Tab-Emulator).
 */
let lastBuzzer: { freq: number; on: boolean } = { freq: 0, on: false };
/** Geteilter Stille-Zustand (vermeidet Allokation im heissen Frame-Pfad). */
const SILENT_BUZZER: { freq: number; on: boolean } = { freq: 0, on: false };

/** Schalter-Beschriftung an das aktive Geraet angleichen. */
function syncDeviceButtons(): void {
  const btn = document.getElementById("dev-toggle");
  if (!btn) return;
  btn.textContent = switchLabel(active);
  // aria-pressed beschreibt hier "ist P2 aktiv" - als Umschalter, nicht als Auswahl.
  btn.setAttribute("aria-pressed", active === "p2" ? "true" : "false");
  btn.setAttribute("aria-label", t("switchTo").replace("{device}", DEVICES[nextDevice(active)].label));
}

/** P2 ist nicht verfuegbar: Schalter sperren statt still scheitern. */
function disableP2(): void {
  p2Available = false;
  const b = document.getElementById("dev-toggle") as HTMLButtonElement | null;
  if (!b) return;
  b.disabled = true;
  b.title = t("p2Unavailable");
}

/**
 * Umschalten auf ein anderes Geraet: Auswahl merken, Schalter nachziehen und
 * den Live-Stream des neuen Tiers starten. Ein Wechsel ist hier nur eine andere
 * Ansicht - der Server haelt das jeweilige Tier weiter.
 */
function setActive(device: Device): void {
  active = device;
  try { localStorage.setItem(DEVICE_KEY, device); } catch { /* Quota */ }
  syncDeviceButtons();
  // Und der alte Piezo-Zustand auch nicht: bis der neue Bind seinen Buzzer
  // liefert, darf kein Restton des vorigen Tiers weiterklingen.
  lastBuzzer = { freq: 0, on: false };
  live.disconnect();
  void startStream();
}

/** Klick auf den Titel-Schalter: auf das andere Geraet wechseln. Der Titel ist
 *  ein Link - Klicks abfangen, sonst springt die Seite nach #top. */
function initDeviceSwitch(): void {
  const btn = document.getElementById("dev-toggle");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    setActive(nextDevice(active, { p2Available }));
  });
}

const loadtxtEl = document.querySelector<HTMLElement>("#loading .loadtxt");
const loadbarEl = document.getElementById("loadbar");

// Das Lade-Overlay als eigener, DOM-injizierbarer Controller (src/ui/boot.ts).
// Grund fuer die Auslagerung: der signed-out-Pfad muss die `#loading`-Gardine
// zuverlaessig schliessen (z-index 50 > Konto-Popover 32), sonst ist der
// Google-Anmeldeknopf unerreichbar. Das ist im Node-Test nur pruefbar, wenn die
// Entscheidung nicht an das import-zeitliche DOM von main.ts gebunden ist.
const bootOverlay = createBootOverlay({ loading: document.getElementById("loading"), loadtext: loadtxtEl, loadbar: loadbarEl });

/** Ersten Frame abwarten, dann das Lade-Overlay ausblenden. */
function markBooted(): void {
  bootOverlay.markBooted();
}

/** Lade-Overlay: kurzer Hinweis, solange der erste Frame aussteht. */
function showConnecting(): void {
  bootOverlay.showConnecting(t("loading"));
}

// ---- Pet-Aufloesung: welches Tier zeigt der aktive Slot? ----
// Die Tier-Liste hat jetzt eine eigene Ansicht (src/ui/pets.ts); hier bleibt nur
// die Zuordnung Slot -> petId ueber die API, damit der Stream das richtige Tier zeigt.

/** Neuestes lebendes Tier des Geraets, sonst das neueste ueberhaupt, sonst nichts. */
function pickPet(pets: PetSummary[], device: Device): PetSummary | null {
  const ofDevice = pets.filter((p) => p.device === device);
  return ofDevice.find((p) => p.alive) ?? ofDevice[0] ?? null;
}

/**
 * Den Live-Stream fuer das aktive Geraet starten.
 *
 * Ohne Anmeldung oder ohne passendes Tier bleibt der Tab offline - das Tier
 * laeuft serverseitig weiter, es gibt nur nichts zu zeigen.
 */
async function startStream(): Promise<void> {
  const s = currentSession();
  showConnecting();
  if (!AUTH_ENABLED || !s) {
    // Ohne Konto gibt es nichts zu streamen: das Lade-Overlay darf nicht ewig
    // stehen bleiben (Task-10-Mandat c). Stattdessen ein klarer Hinweis.
    showSignedOut();
    return;
  }
  const pets = await fetchPets(s.token);
  const pet = pickPet(pets, active);
  if (!pet) {
    if (active === "p2") disableP2();
    // Kein passendes Tier: der Nutzer kann in der Tier-Liste eines anlegen.
    noPetAvailable();
    return;
  }
  currentPetId = pet.id;
  live.connect(pet.id, s.token);
}

// ---- Task 11: Tier-Liste, Speicherstände, Einstellungen, Beep-Verlauf ----
//
// Diese Ansichten haengen an der Task-8-HTTP-API. Sie sind bewusst duenn: die
// Logik steckt in src/ui/*, hier wird nur verdrahtet (oeffnen/schliessen,
// Token, Toast). Ohne Anmeldung bleiben sie leer statt zu scheitern.

/** Aktuell gestreamte petId (fuer die Tier-Liste). */
let currentPetId: string | null = null;

/**
 * Alle Tiere des Nutzers laden.
 *
 * Nutzt den zentralen API-Helper statt eigenem fetch (Task-11-Konsolidierung);
 * liefert eine leere Liste statt zu werfen, damit die UI nie blockiert.
 */
async function fetchPets(token: string): Promise<PetSummary[]> {
  const res = await api.get<PetSummary[]>("/api/pets", token);
  if (!res.ok || !Array.isArray(res.data)) return [];
  return res.data.filter((p) => p && typeof p.id === "string" && (p.device === "p1" || p.device === "p2"));
}

const petsView = createPetsView({
  live,
  token: () => currentSession()?.token ?? null,
  host: document.getElementById("pets-list") ?? undefined,
  onSelect: (petId) => {
    currentPetId = petId;
    // Auswahl uebernimmt das Tier in den Stream; das Menue schliesst.
    const pet = lastPets.find((p) => p.id === petId);
    if (pet) setActive(pet.device);
    closeTask11Windows();
  },
});

let lastPets: PetSummary[] = [];

const slotsView = createSlotsView({
  token: () => currentSession()?.token ?? null,
  host: document.getElementById("slots-list") ?? undefined,
  notify: (msg) => { if (msg) showToast(msg); },
  onChange: () => void refreshSlots(),
});

const settingsView = createSettingsView({
  token: () => currentSession()?.token ?? null,
  onApply: (s) => applyServerSettings(s),
  notify: (msg) => { if (msg) showToast(msg); },
  failMessage: () => t("settingsFailed"),
});

const beepsView = createBeepsView({ host: document.getElementById("beeps-list") ?? undefined });

/**
 * Eine Einstellung serverseitig sichern, wenn ein Konto da ist.
 *
 * Ohne Anmeldung passiert nichts: die lokalen Schalter gelten weiter. So bleibt
 * das Verhalten offline unveraendert und der Server ist die Quelle, sobald man
 * angemeldet ist (Spec §3).
 */
function persistSetting(patch: Partial<Settings>): void {
  if (!currentSession()) return;
  void settingsView.save(patch);
}

/** Ein geladenes Settings-Objekt auf die vorhandene UI anwenden. */
function applyServerSettings(s: Settings): void {
  // Der Server fuehrt dieselben UI-IDs wie die Oberflaeche (theme: blossom/day/
  // …/auto, shell: teal/pink/…); die Pruefung unten ist nur ein Guertel, falls
  // ein unbekannter Wert aus einer alten Zeile kommt. Klang und Push sind boolesch.
  // `applyingFromServer` verhindert, dass die hier angewandten Werte über die
  // Auswahl-Handler wieder zurückgeschrieben werden (Fix A2b).
  applyingFromServer = true;
  try {
    if (SHELLS.some((x) => x.id === s.shell)) {
      const el = document.querySelector(".device-wrap") as HTMLElement | null;
      if (el) applyShell(el, s.shell, localStorage);
      if (miniDevice) miniDevice.dataset.shell = s.shell;
      if (miniWrapEl) miniWrapEl.dataset.shell = s.shell;
      document.querySelectorAll<HTMLElement>(".shellbtn").forEach((el) => el.classList.toggle("active", el.dataset.id === s.shell));
    }
    if (THEMES.some((x) => x.id === s.theme)) applyBg(s.theme, false);
    soundOn = s.sound !== false;
    piezo.setMuted(!soundOn);
    updateSoundLabel();
    notifyEnabled = s.push;
    updateNotifyLabel();
  } finally {
    applyingFromServer = false;
  }
}

/** Speicherstände des aktuellen Tiers neu laden und rendern. */
async function refreshSlots(): Promise<void> {
  if (!currentPetId) { slotsView.render([], ""); return; }
  const slots = await slotsView.list(currentPetId);
  slotsView.render(slots, currentPetId);
}

/** Beep-Verlauf laden und rendern. */
async function refreshBeeps(): Promise<void> {
  const token = currentSession()?.token ?? null;
  const res = await api.get<BeepSummary[]>("/api/beeps", token);
  beepsView.render(res.ok && Array.isArray(res.data) ? res.data : []);
}

/** Tier-Liste neu laden und rendern. */
async function refreshPets(): Promise<void> {
  const token = currentSession()?.token ?? null;
  lastPets = token ? await fetchPets(token) : [];
  petsView.render(lastPets, currentPetId);
}

/** Ein neues Tier anlegen und direkt streamen. */
async function createPet(device: Device): Promise<void> {
  const token = currentSession()?.token ?? null;
  if (!token) return;
  await api.post("/api/pets", token, { device });
  await refreshPets();
  const pet = pickPet(lastPets, device);
  if (pet) { currentPetId = pet.id; setActive(device); }
}

/** Lade-Hinweis fuer abgemeldete Nutzer (kein ewiges Spinner, Mandat c). */
function showSignedOut(): void {
  // Der Nachrichtentext allein genuegt nicht: die Gardine muss zu (sonst liegt
  // sie ueber dem Anmeldeknopf). boot.ts schliesst sie und latched `booted`.
  bootOverlay.showSignedOut(t("signInToPlay"));
}

/**
 * Angemeldet, aber kein passendes Tier: das Overlay aufloesen statt ewig zu
 * spinnen. Der Nutzer legt das Tier in der Tier-Liste an (Menue > Tiere).
 */
function noPetAvailable(): void {
  bootOverlay.noPetAvailable(t("loading"));
}

/** Alle Task-11-Fenster schliessen (Menue + Scrim mitnehmen). */
function closeTask11Windows(): void {
  for (const id of ["pets-pop", "slots-pop", "beeps-pop"]) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }
  const menu = document.getElementById("menu");
  const scrim = document.getElementById("scrim");
  if (scrim && menu && menu.hidden) scrim.hidden = true;
}

/** Ein Task-11-Fenster oeffnen (und die anderen schliessen). */
function openWindow(id: string, onOpen: () => void): void {
  const menu = document.getElementById("menu");
  if (menu && !menu.hidden) {
    menu.hidden = true;
    document.getElementById("btn-menu")?.setAttribute("aria-expanded", "false");
  }
  closeTask11Windows();
  const panel = document.getElementById(id);
  if (panel) panel.hidden = false;
  const scrim = document.getElementById("scrim");
  if (scrim) scrim.hidden = false;
  onOpen();
}

/** Verbindungsstatus als diskreter Indikator (Task-10-Mandat b). */
function updateConnBadge(): void {
  const badge = document.getElementById("conn-badge");
  const text = document.getElementById("conn-text");
  if (!badge) return;
  const st = live.status();
  badge.hidden = false;
  badge.dataset.state = st;
  if (text) text.textContent = t(st === "live" ? "connectionLive" : "connectionOffline");
  badge.title = `${t(st === "live" ? "connectionLive" : "connectionOffline")} — ${t("connectionHint")}`;
}

/** Die drei Task-11-Menueknoepfe und ihre Fenster verdrahten. */
function initTask11(): void {
  document.getElementById("btn-pets")?.addEventListener("click", () => openWindow("pets-pop", () => void refreshPets()));
  document.getElementById("btn-slots")?.addEventListener("click", () => openWindow("slots-pop", () => void refreshSlots()));
  document.getElementById("btn-beeps")?.addEventListener("click", () => openWindow("beeps-pop", () => void refreshBeeps()));
  document.getElementById("pets-close")?.addEventListener("click", closeTask11Windows);
  document.getElementById("slots-close")?.addEventListener("click", closeTask11Windows);
  document.getElementById("beeps-close")?.addEventListener("click", closeTask11Windows);
  document.getElementById("pet-new-p1")?.addEventListener("click", () => void createPet("p1"));
  document.getElementById("pet-new-p2")?.addEventListener("click", () => void createPet("p2"));
  document.getElementById("slot-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("slot-name") as HTMLInputElement | null;
    if (!input || !currentPetId) return;
    const label = input.value;
    input.value = "";
    void slotsView.create(currentPetId, label).then(() => refreshSlots());
  });
  // Verbindungsstatus regelmaessig nachziehen (WS-Zustand kennt keinen Event).
  window.setInterval(updateConnBadge, 1500);
  updateConnBadge();

  // Schliessen per Escape und per Klick auf den Scrim, wie die uebrigen Fenster.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (["pets-pop", "slots-pop", "beeps-pop"].some((id) => !document.getElementById(id)?.hidden)) {
      closeTask11Windows();
    }
  });
  document.getElementById("scrim")?.addEventListener("click", () => {
    const open = ["pets-pop", "slots-pop", "beeps-pop"].some((id) => !document.getElementById(id)?.hidden);
    if (open) closeTask11Windows();
  });
}

/** Anleitung als Fenster im Menue-Stil (Inhalt steht in index.html). */
function initGuideDialog(): void {
  const btn = document.getElementById("btn-guide");
  const panel = document.getElementById("guide-modal");
  const closeEl = document.getElementById("guide-close");
  const grid = document.getElementById("guide-grid");
  const scrim = document.getElementById("scrim");
  if (!btn || !panel) return;
  if (grid) renderIconGrid(grid, iconNames());

  const close = (): void => {
    panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    const menu = document.getElementById("menu");
    if (scrim && menu && menu.hidden) scrim.hidden = true;
    btn.focus();
  };
  const open = (): void => {
    const menu = document.getElementById("menu");
    const acc = document.getElementById("account-pop");
    if (menu && !menu.hidden) {
      menu.hidden = true;
      document.getElementById("btn-menu")?.setAttribute("aria-expanded", "false");
    }
    if (acc) acc.hidden = true;
    panel.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    if (scrim) scrim.hidden = false;
    closeEl?.focus();
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (panel.hidden) open(); else close();
  });
  closeEl?.addEventListener("click", () => close());
  scrim?.addEventListener("click", () => { if (!panel.hidden) close(); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) close(); });
}

function initAccount(): void {
  const btn = document.getElementById("account-btn");
  const face = document.getElementById("account-face");
  const pop = document.getElementById("account-pop");
  const body = document.getElementById("account-body");
  if (!AUTH_ENABLED || !btn || !face || !pop || !body) return;
  const btnEl: HTMLElement = btn;
  const faceEl: HTMLElement = face;
  const popEl: HTMLElement = pop;
  const bodyEl: HTMLElement = body;
  btnEl.hidden = false;
  let gsiAsked = false;

  // Googles Skript erst laden, wenn das Popover offen ist und niemand angemeldet ist.
  function ensureButton(): void {
    if (gsiAsked || currentSession() || popEl.hidden) return;
    const slot = bodyEl.querySelector<HTMLElement>(".gsi-slot");
    if (!slot) return;
    gsiAsked = true;
    void renderSignInButton(slot, () => { render(); live.disconnect(); void startStream(); }).then((ok) => { if (!ok) gsiAsked = false; });
  }

  /** Avatar (Google-Bild, sonst Anfangsbuchstabe) – fuer Kopfzeile und Dialog. */
  function avatarEl(s: Session): HTMLElement {
    const initial = (s.email ?? s.name ?? "?").trim().charAt(0).toUpperCase() || "?";
    if (s.picture) {
      const img = document.createElement("img");
      img.className = "account-face-img";
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.src = s.picture;
      img.addEventListener("error", () => {
        const sp = document.createElement("span");
        sp.className = "account-letter";
        sp.textContent = initial;
        img.replaceWith(sp);
      });
      return img;
    }
    const sp = document.createElement("span");
    sp.className = "account-letter";
    sp.textContent = initial;
    return sp;
  }

  // Avatar in der Kopfzeile: Google-Bild, sonst Anfangsbuchstabe; abgemeldet ein Symbol.
  function renderFace(): void {
    const s = currentSession();
    faceEl.replaceChildren();
    btnEl.classList.toggle("signed-in", !!s);
    if (!s) {
      faceEl.innerHTML =
        '<svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="8.7" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.6 19.2a7 7 0 0 1 12.8 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      return;
    }
    faceEl.append(avatarEl(s));
  }

  function render(): void {
    const s = currentSession();
    bodyEl.replaceChildren();
    // Datenschutz-Hinweis immer am Ende des Konto-Fensters (frueher in guide.html).
    const privacy = (): HTMLElement => {
      const p = document.createElement("p");
      p.className = "account-line account-privacy";
      p.textContent = t("privacyBody");
      return p;
    };
    // Speicherzustand: schuetzt der Browser den Spielstand vor Raeumung?
    const storageLine = (): HTMLElement => {
      const wrap = document.createElement("div");
      wrap.className = "account-storage";
      const line = document.createElement("p");
      line.className = "account-line account-meta";
      line.textContent = `${t("storage")}: …`;
      wrap.append(line);
      void storageInfo().then((info) => {
        if (!info) { line.textContent = t("storage"); return; }
        const mb = (n: number) => (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0);
        const state = info.persisted ? t("storagePersisted") : t("storageVolatile");
        line.textContent = `${t("storage")}: ${mb(info.usage)} / ${mb(info.quota)} MB · ${state}`;
      });
      return wrap;
    };
    if (!s) {
      const hint = document.createElement("p");
      hint.className = "account-line";
      hint.textContent = t("accountHint");
      const slot = document.createElement("div");
      slot.className = "gsi-slot";
      bodyEl.append(hint, slot, storageLine(), privacy());
    } else {
      const idRow = document.createElement("div");
      idRow.className = "account-id";
      const av = document.createElement("span");
      av.className = "account-avatar";
      av.append(avatarEl(s));
      const text = document.createElement("div");
      text.className = "account-id-text";
      const name = document.createElement("p");
      name.className = "account-line account-name";
      name.textContent = s.name ?? s.email ?? "";
      const mail = document.createElement("p");
      mail.className = "account-line account-mail";
      mail.textContent = s.name && s.email ? s.email : "";
      const sync = document.createElement("p");
      sync.className = "account-line account-meta";
      sync.textContent = t("accountSynced");
      text.append(name, mail);
      idRow.append(av, text);
      const out = document.createElement("button");
      out.className = "menu-row";
      out.textContent = t("signOut");
      out.addEventListener("click", () => { signOut(); render(); });
      const delAcc = document.createElement("button");
      delAcc.className = "menu-row danger";
      delAcc.textContent = t("deleteAccount");
      delAcc.addEventListener("click", () => {
        close();
        if (accountModal) accountModal.hidden = false;
      });
      bodyEl.append(idRow, sync, out, delAcc, storageLine(), privacy());
    }
    renderFace();
    ensureButton();
  }

  const closeEl = document.getElementById("account-close");
  const scrimEl = document.getElementById("scrim");
  const menuPanel = document.getElementById("menu");
  const menuToggle = document.getElementById("btn-menu");
  const accountModal = document.getElementById("account-modal");

  document.getElementById("account-cancel")?.addEventListener("click", () => {
    if (accountModal) accountModal.hidden = true;
    btnEl.focus();
  });
  accountModal?.addEventListener("click", (e) => { if (e.target === accountModal) accountModal.hidden = true; });
  document.getElementById("account-confirm")?.addEventListener("click", () => {
    void (async () => {
      // Das Konto loeschen liegt serverseitig noch nicht an (kein DELETE /api/pets);
      // hier wird nur lokal abgemeldet. Die Tier-Daten bleiben auf dem Server.
      signOut();
      location.reload();
    })();
  });

  const close = (): void => {
    popEl.hidden = true;
    btnEl.setAttribute("aria-expanded", "false");
    if (scrimEl && menuPanel && menuPanel.hidden) scrimEl.hidden = true;
    btnEl.focus();
  };
  const open = (): void => {
    // Nicht beide Fenster gleichzeitig offen halten.
    if (menuPanel && !menuPanel.hidden) {
      menuPanel.hidden = true;
      menuToggle?.setAttribute("aria-expanded", "false");
    }
    popEl.hidden = false;
    btnEl.setAttribute("aria-expanded", "true");
    if (scrimEl) scrimEl.hidden = false;
    render(); // erst einblenden, sonst laedt der Google-Button nicht
    closeEl?.focus();
  };
  btnEl.addEventListener("click", (e) => {
    e.stopPropagation();
    if (popEl.hidden) open(); else close();
  });
  closeEl?.addEventListener("click", () => close());
  scrimEl?.addEventListener("click", () => { if (!popEl.hidden) close(); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !popEl.hidden) close(); });

  // Silent-Refresh: GIS im Hintergrund initialisieren, damit ein abgelaufenes
  // ID-Token ohne manuellen Login erneuert wird. Der Callback laeuft auch ohne
  // sichtbaren Button. Bei einem stillen Refresh nur die UI aktualisieren.
  //
  // Reihenfolge ist wichtig: das abgelaufene Token in localStorage ist der einzige
  // Hinweis fuer GIS, dass ueberhaupt ein Konto hinterlegt war. Es darf erst
  // geloescht werden, wenn der stille Refresh laufen kann - sonst meldet sich
  // GIS nie und der Nutzer muss sich neu anmelden.
  restoreSession();
  renderFace();
  render();

  void initGsi(() => {}).then((id) => {
    if (!id) return;
    renderFace();
    onSessionRefresh(() => {
      render();
      // Frisches Token: den Live-Stream (neu) aufbauen.
      live.disconnect();
      void startStream();
    });
  });
}

function saveNow(): void {
  // Der Spielstand liegt jetzt auf dem Server; der Tab hat nichts mehr zu sichern.
  // Beim Verlassen wird nur noch die Live-Verbindung abgeraeumt (der Server
  // laesst das Tier ohnehin weiterlaufen).
}

async function boot(): Promise<void> {
  // PWA-Lifecycle zuerst: Update-Prompt und Offline-Banner sollen früh stehen,
  // auch wenn noch kein Frame da ist.
  initPwa({ toast: showToast });

  active = pickInitialDevice(localStorage.getItem(DEVICE_KEY), { p2Available });
  syncDeviceButtons();
  bindButtons();
  initTask11();
  // Die 8 echten P1-Icon-Grafiken laden (fuer Live-Reihen + Vorschau-Karten).
  iconImgs = await loadIcons();
  paintMiniIcons();
  // Der Server schickt Frames; hier wird nur gezeichnet. Den Ton liefert der
  // Server ueber `{t:"buzzer", freq, on}`: der Tab selbst laeuft nicht mehr,
  // hoert aber den Piezo des serverseitigen Tiers. Der Zustand wird gemerkt und
  // pro Zeichenframe an den WebAudio-Piezo gegeben (siehe `frame()`).
  live.onFrame((lcd, icons) => { lastFrame = lcd; lastIcons = icons; markBooted(); });
  live.onBuzzer((b) => { lastBuzzer = b; });
  // Verbindungsstatus folgt dem Live-Client statt nur navigator.onLine
  // (Task-10-Mandat b): ein abgerissener Socket wird so sichtbar.
  live.onState(() => updateConnBadge());
  requestAnimationFrame(frame);

  // Einstellungen vom Server laden, sobald ein Konto da ist. Ohne Konto
  // bleiben die lokalen Schalter wie gehabt.
  if (currentSession()) void settingsView.load();

  if (params.has("debug")) {
    const w = window as unknown as {
      __live: LiveClient;
      __frame: () => Uint8Array | null;
      __setActive: (d: Device) => void;
      __notify: (t: string, b: string) => Promise<void>;
      __audio: () => ReturnType<typeof piezo.state>;
    };
    w.__live = live;
    w.__frame = () => lastFrame;
    w.__setActive = setActive;
    w.__notify = notify;
    w.__audio = () => piezo.state();
  }

  // Nach dem Anmelden den Stream fuer das aktive Geraet starten. Die Anmeldung
  // laeuft parallel (initAccount) und stoesst startStream erneut an, sobald eine
  // Session da ist (siehe onSessionRefresh).
  void startStream();
}

function bindButtons(): void {
  // AudioContext erst nach einer echten Nutzer-Geste erzeugen/resumen (Autoplay-Policy).
  // Beide Listener bleiben aktiv: schlaegt die Erzeugung einmal fehl, greift die
  // naechste Geste. Kein "once", sonst waere der Ton danach endgueltig tot.
  const unlock = (): void => piezo.unlock();
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);

  const pressed = new Set<LogicalButton>();
  const set = (b: LogicalButton, down: boolean) => {
    if (down) pressed.add(b); else pressed.delete(b);
    // Beide Flanken senden: der Server haelt jeden gedrueckten Pin unten, damit
    // eine echte Zweifinger-Kombi (SELECT+NEXT = A+C, Ton an/aus) als
    // *gleichzeitiger* Druck beim ROM ankommt. Der Server faehrt die
    // Mindest-Haltezeit selbst (Protokoll {t:"btn", btn, down}).
    if (down) {
      live.pressDown(BUTTON_MAP[b] as Btn);
    } else {
      live.pressUp(BUTTON_MAP[b] as Btn);
    }
  };
  const releaseAll = () => { for (const b of [...pressed]) set(b, false); };

  (["a", "b", "c"] as const).forEach((id) => {
    const el = document.getElementById(`btn-${id}`)!;
    const b = id.toUpperCase() as LogicalButton;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      set(b, true);
    });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  });

  // Global freigeben – greift auch, wenn der Zeiger den Button verlässt.
  (["pointerup", "pointercancel", "mouseup", "touchend", "blur"] as const).forEach((ev) =>
    window.addEventListener(ev, releaseAll),
  );
  document.addEventListener("visibilitychange", () => {
    // Verlaesst der Tab den Vordergrund, alle gedrueckten Tasten freigeben –
    // sonst blieben Pins serverseitig haengen. Zurueck im Tab passiert nichts.
    if (document.hidden) releaseAll();
  });

  // Pet-Buttons nur, solange kein Dialog offen ist (sonst würde z. B. Escape im
  // Menü gleichzeitig Button C auslösen).
  const dialogOpen = (): boolean => {
    const m = document.getElementById("menu");
    const d = document.getElementById("modal");
    return !!((m && !m.hidden) || (d && !d.hidden));
  };
  window.addEventListener("keydown", (e) => { if (dialogOpen()) return; const b = handleKey(e.key); if (b) set(b, true); });
  window.addEventListener("keyup", (e) => { if (dialogOpen()) return; const b = handleKey(e.key); if (b) set(b, false); });
}

/**
 * Zeichnet den zuletzt empfangenen Frame. Der Server liefert die LCD-Bits **und**
 * die 8 P1-Icon-Segment-Bits (`{t:"frame", lcd, icons}`, lcd bit-gepackt +
 * base64; `icons` optional, fehlt solange alle Bits 0 sind). Die Icons sind echte
 * LCD-Segmente des Treibers (`hw_set_lcd_pin`, seg 8/28); die Reihe oben/unten
 * spiegelt jetzt diesen uebertragenen Zustand statt eines hartkodierten leeren
 * Puffers. Beim ausgelieferten P1-ROM treibt das ROM die Segmente derzeit nicht,
 * daher bleibt die Reihe faktisch dezent – sie leuchtet aber auf, sobald ein
 * ROM/Geraet die Segmente treibt, ohne weitere Protokollaenderung.
 */
function frame(): void {
  // Piezo aus dem Live-Kanal speisen. Der Server schickt nur bei Aenderung,
  // `update` ist aber idempotent (setzt die Verstaerkung jeden Frame neu) und
  // weckt einen suspended Kontext. So klingt das serverseitige Tier im Tab,
  // sofern Audio entsperrt und nicht stummgeschaltet ist.
  //
  // Faellt die Verbindung, bleibt der zuletzt gemeldete Zustand stehen - ein
  // Ton, der beim Socket-Abriss an war, wuerde sonst endlos weiterklingen.
  // Offline erzwingt daher Stille, bis der naechste Bind seinen Buzzer liefert.
  if (live.status() !== "live") {
    piezo.update(SILENT_BUZZER.freq, SILENT_BUZZER.on);
  } else {
    piezo.update(lastBuzzer.freq, lastBuzzer.on);
  }
  const lcd = lastFrame;
  if (lcd) {
    const scale = Math.max(1, Math.floor(canvas.clientWidth / LCD_WIDTH));
    if (canvas.width !== LCD_WIDTH * scale) {
      canvas.width = LCD_WIDTH * scale;
      canvas.height = LCD_HEIGHT * scale;
      for (const el of [iconsTop, iconsBottom]) { el.width = LCD_WIDTH * scale; el.height = 8 * scale; }
    }
    drawLcd(ctx, lcd, scale);
    drawIconRow(ctxTop, lastIcons, 0, scale, iconImgs);
    drawIconRow(ctxBottom, lastIcons, 1, scale, iconImgs);

    // Mini-Vorschau nur spiegeln, wenn das Menü offen ist.
    if (miniLcd && miniLcdCtx && menuEl && !menuEl.hidden) {
      const ms = 4;
      miniLcd.width = LCD_WIDTH * ms; miniLcd.height = LCD_HEIGHT * ms;
      drawLcd(miniLcdCtx, lcd, ms);
      if (miniTop && miniTopCtx) { miniTop.width = LCD_WIDTH * ms; miniTop.height = 8 * ms; drawIconRow(miniTopCtx, lastIcons, 0, ms, iconImgs); }
      if (miniBottom && miniBottomCtx) { miniBottom.width = LCD_WIDTH * ms; miniBottom.height = 8 * ms; drawIconRow(miniBottomCtx, lastIcons, 1, ms, iconImgs); }
    }
  }
  requestAnimationFrame(frame);
}

// Beim Verlassen/Verstecken der Seite nur noch die Verbindung abraeumen - der
// Server laesst das Tier weiterlaufen (der Tab war nie die Quelle der Zeit).
window.addEventListener("pagehide", saveNow);

boot();
