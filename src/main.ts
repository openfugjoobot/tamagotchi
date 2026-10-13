import { createEmulator, LCD_WIDTH, LCD_HEIGHT } from "./emu/emulator";
import { STEPS_PER_SECOND, unitsForMs, Pacer } from "./emu/clock";
import type { Emulator } from "./emu/emulator";
import { drawLcd } from "./render/lcd";
import { drawIconRow, loadIcons, renderIconGrid, type IconImages } from "./render/icons";
import { handleKey, BUTTON_MAP, type LogicalButton } from "./emu/input";
import { createPiezo } from "./emu/audio";
import { saveEmu, loadEmu, readSaveRecord } from "./storage/persist";
import { AUTH_ENABLED } from "./auth/config";
import { currentSession, restoreSession, renderSignInButton, signOut, type Session } from "./auth/google";
import { deleteRemote, readSave, planSync, pushSave, type CloudSave, type SyncAction } from "./sync/cloud";
import { SHELLS, applyShell, savedShell, starPolygon, type Shell } from "./shell";
import { buildGrass } from "./grass";
import { applyI18n, currentLang, iconNames, t } from "./i18n";
import { THEMES, BG_KEY, AUTO, savedBg, resolveTheme } from "./theme";
import { SOUND_KEY, NOTIFY_KEY, EMU_KEY } from "./storage/keys";

const canvas = document.getElementById("lcd") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const iconsTop = document.getElementById("icons-top") as HTMLCanvasElement;
const iconsBottom = document.getElementById("icons-bottom") as HTMLCanvasElement;
const ctxTop = iconsTop.getContext("2d")!;
const ctxBottom = iconsBottom.getContext("2d")!;

// Mini-Vorschau im Menü
let miniDevice: HTMLElement | null = null;
let miniWrapEl: HTMLElement | null = null;
let miniTop: HTMLCanvasElement | null = null;
let miniLcd: HTMLCanvasElement | null = null;
let miniBottom: HTMLCanvasElement | null = null;
let miniTopCtx: CanvasRenderingContext2D | null = null;
let miniLcdCtx: CanvasRenderingContext2D | null = null;
let miniBottomCtx: CanvasRenderingContext2D | null = null;
const piezo = createPiezo(() => new AudioContext());
const loadingEl = document.getElementById("loading");
const menuEl = document.getElementById("menu");

// Service Worker registrieren (ausgelagert, damit kein Inline-Script nötig ist → strikte CSP).
// Der SW ist network-first, Inhalte kommen also ohnehin frisch. Kein Auto-Reload bei
// Updates: der erzeugte beim SW-Wechsel (controllerchange) einen zweiten Lade-Spinner.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js?v=5", { updateViaCache: "none" }).then((r) => r.update()).catch(() => { /* ignore */ });
}

const params = new URLSearchParams(location.search);
const SPEED = Math.max(1, Number(params.get("speed") ?? "1") || 1);
// Testmodus: feste Schrittzahl, ein Frame, dann Stopp (kein rAF-Loop).
const STATIC = Number(params.get("static") ?? "0") || 0;
const shellParam = params.get("shell");

// ---- Hintergrund-Themes (Definition in src/theme.ts) ----
// "auto" wählt nach Tageszeit; gespeichert wird die Auswahl, angezeigt das Theme.
let selectedBg = "day";

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
      b.addEventListener("click", () => applyBg(t.id));
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
    miniTop = cvs[0] ?? null; miniLcd = cvs[1] ?? null; miniBottom = cvs[2] ?? null;
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
      b.addEventListener("click", () => setShell(s.id));
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
    const setW = (): number => N * itemW();
    const centerOf = (card: HTMLElement): number => card.offsetLeft - (carousel.clientWidth - card.offsetWidth) / 2;
    const centeredIndex = (): number => {
      const mid = carousel.scrollLeft + carousel.clientWidth / 2;
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      cards.forEach((c, i) => {
        const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
        if (d < bestD) { bestD = d; best = i; }
      });
      return best;
    };

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
        `<span class="mini-screen"></span>` +
        `</span>`;
      wrap.append(ring, dev);
      const name = document.createElement("span");
      name.className = "shell-name";
      name.textContent = shell.id.charAt(0).toUpperCase() + shell.id.slice(1);
      card.append(wrap, name);
      return card;
    };

    let current = "";
    const markCards = (): void => {
      carousel.querySelectorAll<HTMLElement>(".shell-card").forEach((el) => {
        el.setAttribute("aria-selected", String(el.dataset.shell === current));
      });
    };
    // Kurzer Puls am Geraet statt bildschirmgrosser Kreuzblende – wirkt fluessiger.
    const pulse = (): void => {
      deviceEl2.classList.remove("shell-swap");
      void deviceEl2.offsetWidth; // Animation neu anstossen
      deviceEl2.classList.add("shell-swap");
      window.setTimeout(() => deviceEl2.classList.remove("shell-swap"), 320);
    };
    const pickShell = (id: string, animate = true): void => {
      current = id;
      applyShell(deviceEl2, id, localStorage);
      const shape = SHELLS.find((s) => s.id === id)?.star;
      if (shape) deviceEl2.querySelector("svg.star polygon")?.setAttribute("points", starPolygon(shape));
      markCards();
      if (animate) pulse();
    };

    for (let set = 0; set < 3; set++) for (const s of SHELLS) cards.push(makeCard(s));
    const track = document.createElement("span");
    track.className = "shell-track";
    track.append(...cards);
    carousel.replaceChildren(track);

    const initial = shellParam && SHELLS.some((s) => s.id === shellParam) ? shellParam : savedShell(localStorage);
    const idx = Math.max(0, SHELLS.findIndex((s) => s.id === initial));
    // Das Menue ist beim Aufbau versteckt (display:none) – ein verstecktes Element
    // laesst sich nicht scrollen. Startposition daher beim ersten Oeffnen setzen.
    const menuEl = document.getElementById("menu");
    let posSet = false;
    const startIndex = N + idx;
    const placeOnce = (): void => {
      if (posSet || !menuEl || menuEl.hidden) return;
      posSet = true;
      if (cards[startIndex]) carousel.scrollLeft = centerOf(cards[startIndex]);
    };
    if (menuEl) new MutationObserver(placeOnce).observe(menuEl, { attributes: true, attributeFilter: ["hidden"] });
    placeOnce();
    pickShell(initial, false);

    let selectTimer = 0;
    carousel.addEventListener("scroll", () => {
      // Aus den aeusseren Saetzen unbemerkt in die Mitte springen -> endlos.
      const w = setW();
      if (carousel.scrollLeft < w * 0.5) carousel.scrollLeft += w;
      else if (carousel.scrollLeft > w * 1.5) carousel.scrollLeft -= w;
      window.clearTimeout(selectTimer);
      selectTimer = window.setTimeout(() => {
        const shell = SHELLS[centeredIndex() % N];
        if (shell.id !== current) pickShell(shell.id, true); else markCards();
      }, 140);
    });
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
    try { localStorage.removeItem(EMU_KEY); } catch { /* ignore */ }
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
  });

  document.getElementById("btn-notify")?.addEventListener("click", async () => {
    if (notifyEnabled) {
      notifyEnabled = false;
      try { localStorage.setItem(NOTIFY_KEY, "0"); } catch { /* ignore */ }
      updateNotifyLabel();
      return;
    }
    if (!("Notification" in window)) return;
    try {
      const perm = await Notification.requestPermission();
      notifyEnabled = perm === "granted";
      try { localStorage.setItem(NOTIFY_KEY, notifyEnabled ? "1" : "0"); } catch { /* ignore */ }
    } catch { notifyEnabled = false; }
    updateNotifyLabel();
  });

  // ---- i18n (Sprache folgt der Browsersprache) ----
  applyI18n();
  document.documentElement.lang = currentLang();

  // ---- Install-Hinweis (PWA) ----
  const installBtn = document.getElementById("btn-install");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    (window as unknown as { __installPrompt?: unknown }).__installPrompt = e;
    if (installBtn) installBtn.hidden = false;
  });
  installBtn?.addEventListener("click", () => {
    const p = (window as unknown as { __installPrompt?: { prompt(): void; userChoice: Promise<unknown> } }).__installPrompt;
    if (!p) return;
    p.prompt();
    void p.userChoice.finally(() => { (window as unknown as { __installPrompt?: unknown }).__installPrompt = undefined; installBtn.hidden = true; });
    closeMenu();
  });
  window.addEventListener("appinstalled", () => { if (installBtn) installBtn.hidden = true; });

  // Konto (nur wenn eine Client-ID hinterlegt ist)
  initAccount();
  initGuideDialog();

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

// Zeitmodell siehe src/emu/clock.ts: alles relativ, kein Zeitlimit mehr.
const MAX_STEPS_PER_FRAME = 120 * STEPS_PER_SECOND;
const MAX_FRAME_CATCHUP_MS = 120 * 1000; // pro Frame höchstens 120 s reales Delta annehmen
const CATCHUP_CHUNK_STEPS = 4 * 1000 * 1000; // Nachhol-Modus: alle ~4 Mio. Schritte kurz freigeben

const pacer = new Pacer();

function pump(maxSteps: number): void {
  if (!emu) return;
  const steps = pacer.take(maxSteps);
  if (steps > 0) emu.step(steps);
}

let emu: Emulator | null = null;
let iconImgs: IconImages = [];
let lastTs = 0;
let saveTick = 0;
let booted = false;

const loadtxtEl = document.querySelector<HTMLElement>("#loading .loadtxt");
const loadbarEl = document.getElementById("loadbar");
const loadbarFill = document.getElementById("loadbar-fill");

function showCatchup(frac: number): void {
  const pct = Math.round(Math.min(1, Math.max(0, frac)) * 100);
  const label = t("loading").replace(/…/g, "").trim();
  if (loadtxtEl) loadtxtEl.textContent = `${label} ${pct}%`;
  if (loadbarEl) loadbarEl.hidden = false;
  if (loadbarFill) loadbarFill.style.width = pct + "%";
}

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Holt beliebig viel Emulator-Zeit nach – in Chunks mit Fortschritt, statt den
// Tab minutenlang einzufrieren. Ohne Limit: auch Tage/Wochen Abwesenheit.
async function catchUpAll(units: number): Promise<void> {
  if (!emu || units <= 0) return;
  pacer.add(units);
  const total = units;
  let lastPaint = 0;
  while (pacer.owedUnits > 0) {
    pump(CATCHUP_CHUNK_STEPS);
    const now = performance.now();
    if (now - lastPaint > 100) { lastPaint = now; showCatchup(1 - pacer.owedUnits / total); }
    await nextTick();
  }
  showCatchup(1);
  if (loadtxtEl) loadtxtEl.textContent = t("loading");
  if (loadbarEl) loadbarEl.hidden = true;
}

// ---- Konto & Cloud-Speicher (siehe docs/AUTH-SYNC.md) ----
let cloudDirty = false;
let cloudTimer: number | null = null;

// Nach jedem lokalen Speichern den Cloud-Push entprellt nachziehen (max. alle 30 s).
function markCloudDirty(): void {
  if (!AUTH_ENABLED) return;
  cloudDirty = true;
  if (cloudTimer !== null) return;
  cloudTimer = window.setTimeout(() => { cloudTimer = null; void flushCloud(); }, 30_000);
}

async function flushCloud(): Promise<void> {
  const s = currentSession();
  if (!s || !cloudDirty) return;
  const rec = readSaveRecord(localStorage);
  if (!rec) return;
  const ok = await pushSave(s.token, { snapshot: rec.d, updatedAt: new Date(rec.t).toISOString(), saveVer: 1 });
  if (ok) cloudDirty = false;
}

/** Fragt, welcher Spielstand gelten soll (Cloud oder dieses Gerät). */
function askWhichSave(localAt: number, cloudAt: string): Promise<"push" | "pull"> {
  return new Promise((resolve) => {
    const panel = document.getElementById("save-modal");
    const hint = document.getElementById("save-hint");
    const keepBtn = document.getElementById("save-keep");
    const cloudBtn = document.getElementById("save-cloud");
    if (!panel || !hint || !keepBtn || !cloudBtn) {
      resolve("pull");
      return;
    }
    const fmt = (v: number | string): string =>
      new Date(v).toLocaleString(currentLang(), { dateStyle: "short", timeStyle: "short" });
    hint.textContent = t("saveBody").replace("{cloud}", fmt(cloudAt)).replace("{local}", fmt(localAt));
    const finish = (choice: "push" | "pull"): void => {
      panel.hidden = true;
      keepBtn.removeEventListener("click", onKeep);
      cloudBtn.removeEventListener("click", onCloud);
      resolve(choice);
    };
    const onKeep = (): void => finish("push");
    const onCloud = (): void => finish("pull");
    keepBtn.addEventListener("click", onKeep);
    cloudBtn.addEventListener("click", onCloud);
    panel.hidden = false;
  });
}

/**
 * Nach dem Login den geladenen Cloud-Stand in den laufenden Emulator bringen.
 *
 * Frueher rief der Login-Pfad location.reload() auf. Das war doppelt schlecht:
 * die Session liegt in sessionStorage und stirbt mit dem Tab - nach dem
 * Reload war sie weg, syncBeforeBoot stieg wieder aus, und der Abgleich machte
 * sich selbst zunichte. Stattdessen wird hier der Emulator neu gestartet.
 */
async function reloadAfterCloud(): Promise<void> {
  if (!emu) { location.reload(); return; }
  let saved: Awaited<ReturnType<typeof loadEmu>> = null;
  try { saved = await loadEmu(localStorage); } catch { /* Quota/kaputt */ }
  if (!saved) { location.reload(); return; }
  try { emu.loadState(saved.bytes); } catch { location.reload(); return; }
  if (saved.at) await catchUpAll(unitsForMs(Math.max(0, Date.now() - saved.at)));
  lastTs = performance.now();
}

/** Cloud-Stand lokal ablegen; mitten in der Sitzung danach neu laden. */
function applyCloudSave(cloud: CloudSave, reload: boolean): void {
  const at = Date.parse(cloud.updatedAt);
  try {
    localStorage.setItem(EMU_KEY, JSON.stringify({ t: Number.isFinite(at) ? at : Date.now(), d: cloud.snapshot }));
  } catch { /* Quota */ }
  if (reload) location.reload();
}
function asCloud(rec: { d: string; t: number }): CloudSave {
  return { snapshot: rec.d, updatedAt: new Date(rec.t).toISOString(), saveVer: 1 };
}

/**
 * Direkt nach dem Anmelden abgleichen - ohne Neuladen: bei Konflikt fragen,
 * sonst den neueren Stand gewinnen lassen.
 *
 * Achtung: Hier laeuft der Emulator bereits. Ein Cloud-Stand kann daher nicht
 * einfach "hineingeladen" werden wie beim Boot - er wird im localStorage
 * abgelegt und der Emulator anschliessend aus dem neuen Stand neu gestartet
 * (siehe reloadAfterCloud), statt die ganze Seite neu zu laden.
 */
async function syncAfterSignIn(): Promise<void> {
  const s = currentSession();
  if (!s) return;
  const local = readSaveRecord(localStorage);
  // readSave unterscheidet "keine Cloud" von "Abruf gescheitert". Ein
  // gescheiterter Abruf fuehrt zu "none" - es wird NICHT mehr still
  // hochgeladen, nur weil man nicht nachsehen konnte.
  const cloud = await readSave(s.token);
  // Beim Anmelden: sobald ein Cloud-Stand da ist, die Wahl anbieten - auch wenn
  // die lokale Session (frisch gestartet) zeitlich "neuer" ist. Ihr Stand ist
  // wertlos, darf die Cloud also nicht still ueberschreiben.
  let action: SyncAction = planSync(cloud, local?.t ?? null, { forceAsk: true });
  if (action === "ask") action = await askWhichSave(local?.t ?? 0, cloud.kind === "found" ? cloud.save.updatedAt : "");
  if (action === "pull" && cloud.kind === "found") {
    applyCloudSave(cloud.save, false);
    await reloadAfterCloud();
    return;
  }
  if (action === "push" && local) await pushSave(s.token, asCloud(local));
}

/** Vor dem Laden des Spielstands: Cloud und lokal abgleichen (neuerer gewinnt). */
async function syncBeforeBoot(): Promise<void> {
  const s = currentSession();
  if (!s) return;
  const local = readSaveRecord(localStorage);
  const cloud = await readSave(s.token);
  // Immer fragen, wenn beide Seiten einen Stand haben - nichts still ueberschreiben.
  let action: SyncAction = planSync(cloud, local?.t ?? null);
  if (action === "ask") action = await askWhichSave(local?.t ?? 0, cloud.kind === "found" ? cloud.save.updatedAt : "");
  if (action === "pull" && cloud.kind === "found") {
    applyCloudSave(cloud.save, false);
  } else if (action === "push" && local) {
    void pushSave(s.token, asCloud(local));
  }
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
    void renderSignInButton(slot, () => { render(); void syncAfterSignIn(); }).then((ok) => { if (!ok) gsiAsked = false; });
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
    if (!s) {
      const hint = document.createElement("p");
      hint.className = "account-line";
      hint.textContent = t("accountHint");
      const slot = document.createElement("div");
      slot.className = "gsi-slot";
      bodyEl.append(hint, slot);
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
      bodyEl.append(idRow, sync, out, delAcc);
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
      const tok = currentSession()?.token;
      if (tok) await deleteRemote(tok);
      try { localStorage.removeItem(EMU_KEY); } catch { /* ignore */ }
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

  restoreSession();
  renderFace();
  render();
}

function saveNow(): void {
  if (SPEED !== 1 || !emu) return;
  const state = emu.saveState();
  void saveEmu(localStorage, state).catch(() => { /* Quota */ });
  markCloudDirty();
}

async function boot(): Promise<void> {
  const [wasm, romBuf] = await Promise.all([
    fetch("/emu/tamalib.wasm").then((r) => r.arrayBuffer()),
    fetch("/emu/rom0.bin").then((r) => r.arrayBuffer()),
  ]);
  emu = await createEmulator({ wasm, rom: new Uint8Array(romBuf) });
  iconImgs = await loadIcons();
  if (params.has("debug")) {
    const w = window as unknown as { __emu: Emulator; __notify: (t: string, b: string) => Promise<void>; __sync: () => Promise<void> };
    w.__emu = emu;
    w.__notify = notify;
    w.__sync = syncAfterSignIn;
  }

  if (AUTH_ENABLED) await syncBeforeBoot();

  let saved: Awaited<ReturnType<typeof loadEmu>> = null;
  if (SPEED === 1) {
    saved = await loadEmu(localStorage);
    if (saved) {
      try { emu.loadState(saved.bytes); } catch { /* inkompatibler Save */ }
    }
  }
  // Die komplette Abwesenheit nachholen – kein Zeitlimit. In Chunks, damit der
  // Tab nicht einfriert; der Fortschritt läuft im Lade-Overlay.
  if (saved?.at) {
    await catchUpAll(unitsForMs(Math.max(0, Date.now() - saved.at)));
  }

  bindButtons();
  lastTs = performance.now();
  // Robust speichern: beim Verlassen/Verstecken der Seite sofort sichern.
  window.addEventListener("pagehide", saveNow);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { saveNow(); void flushCloud(); return; }
    // Zurück im Vordergrund: verpasste Zeit nachholen (Mobile drosselt Timer im
    // Hintergrund). Kurze Lücken frisst der Frame-Loop; lange laufen mit Fortschritt.
    const dt = Math.min(performance.now() - lastTs, 30 * 24 * 3600 * 1000);
    lastTs = performance.now();
    if (dt <= 0) return;
    if (dt > 30 * 1000) void catchUpAll(unitsForMs(dt * SPEED));
    else pacer.add(unitsForMs(dt * SPEED));
  });
  requestAnimationFrame(frame);
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
    emu?.setButton(BUTTON_MAP[b], down);
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
  document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAll(); });

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

function frame(ts: number): void {
  if (!emu) return;
  if (STATIC > 0) {
    emu.step(STATIC);
  } else {
    const dt = Math.min(Math.max(0, ts - lastTs), MAX_FRAME_CATCHUP_MS);
    lastTs = ts;
    pacer.add(unitsForMs(dt * SPEED));
    pump(MAX_STEPS_PER_FRAME);
  }

  const scale = Math.max(1, Math.floor(canvas.clientWidth / LCD_WIDTH));
  if (canvas.width !== LCD_WIDTH * scale) {
    canvas.width = LCD_WIDTH * scale;
    canvas.height = LCD_HEIGHT * scale;
    for (const el of [iconsTop, iconsBottom]) { el.width = LCD_WIDTH * scale; el.height = 8 * scale; }
  }
  drawLcd(ctx, emu.lcd(), scale);

  const icons = emu.icons();
  drawIconRow(ctxTop, icons, 0, scale, iconImgs);
  drawIconRow(ctxBottom, icons, 1, scale, iconImgs);

  // Mini-Vorschau nur spiegeln, wenn das Menü offen ist.
  if (miniLcd && miniLcdCtx && menuEl && !menuEl.hidden) {
    const ms = 4;
    miniLcd.width = LCD_WIDTH * ms; miniLcd.height = LCD_HEIGHT * ms;
    drawLcd(miniLcdCtx, emu.lcd(), ms);
    if (miniTop && miniTopCtx) { miniTop.width = LCD_WIDTH * ms; miniTop.height = 8 * ms; drawIconRow(miniTopCtx, icons, 0, ms, iconImgs); }
    if (miniBottom && miniBottomCtx) { miniBottom.width = LCD_WIDTH * ms; miniBottom.height = 8 * ms; drawIconRow(miniBottomCtx, icons, 1, ms, iconImgs); }
  }

  const b = emu.buzzer();
  piezo.update(b.freq, b.on);
  if (emu.takeBuzzer() && (!document.hasFocus() || document.hidden)) {
    void notify(t("notifyTitle"), t("notifyBody"));
  }

  // periodisch speichern (alle ~5s)
  if (SPEED === 1 && STATIC === 0 && ++saveTick % 300 === 0) {
    void saveEmu(localStorage, emu.saveState()).catch(() => { /* Quota */ });
    markCloudDirty();
  }
  if (!booted && pacer.owedUnits <= 0) { booted = true; loadingEl?.classList.add("hidden"); }
  if (STATIC === 0) requestAnimationFrame(frame);
}

// Im Hintergrund weiterlaufen lassen und bei Rufen benachrichtigen.
setInterval(() => {
  if (!document.hidden || !emu || SPEED !== 1) return;
  const now = performance.now();
  const dt = Math.min((now - lastTs) / 1000, 3600);
  lastTs = now;
  pacer.add(unitsForMs(dt * 1000));
  pump(MAX_STEPS_PER_FRAME);
  if (emu.takeBuzzer() && (!document.hasFocus() || document.hidden)) {
    void notify(t("notifyTitle"), t("notifyBody"));
  }
}, 5000);

boot();
