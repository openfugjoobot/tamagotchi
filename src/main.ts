import { createEmulator, LCD_WIDTH, LCD_HEIGHT } from "./emu/emulator";
import type { Emulator } from "./emu/emulator";
import { drawLcd } from "./render/lcd";
import { drawIconRow, loadIcons, type IconImages } from "./render/icons";
import { handleKey, BUTTON_MAP, type LogicalButton } from "./emu/input";
import { createPiezo } from "./emu/audio";
import { saveEmu, loadEmu } from "./storage/persist";
import { SHELLS, applyShell, savedShell } from "./shell";
import { buildGrass } from "./grass";

const canvas = document.getElementById("lcd") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const iconsTop = document.getElementById("icons-top") as HTMLCanvasElement;
const iconsBottom = document.getElementById("icons-bottom") as HTMLCanvasElement;
const ctxTop = iconsTop.getContext("2d")!;
const ctxBottom = iconsBottom.getContext("2d")!;

// Mini-Vorschau im Menü
let miniDevice: HTMLElement | null = null;
let miniTop: HTMLCanvasElement | null = null;
let miniLcd: HTMLCanvasElement | null = null;
let miniBottom: HTMLCanvasElement | null = null;
let miniTopCtx: CanvasRenderingContext2D | null = null;
let miniLcdCtx: CanvasRenderingContext2D | null = null;
let miniBottomCtx: CanvasRenderingContext2D | null = null;
const piezo = createPiezo(() => new AudioContext());
const loadingEl = document.getElementById("loading");
const menuEl = document.getElementById("menu");

const params = new URLSearchParams(location.search);
const SPEED = Math.max(1, Number(params.get("speed") ?? "1") || 1);
// Testmodus: feste Schrittzahl, ein Frame, dann Stopp (kein rAF-Loop).
const STATIC = Number(params.get("static") ?? "0") || 0;
const shellParam = params.get("shell");

// ---- Hintergrund-Themes ----
const BG_KEY = "tamagotchi.bg";
const THEMES: { id: string; c: string }[] = [
  { id: "day", c: "#bcd7ff" },
  { id: "blossom", c: "#ffc2d6" },
  { id: "forest", c: "#cfe6cf" },
  { id: "dusk", c: "#e08a5a" },
  { id: "night", c: "#14233a" },
  { id: "midnight", c: "#05060a" },
];
function applyBg(id: string): void {
  document.body.dataset.bg = id;
  try { localStorage.setItem(BG_KEY, id); } catch { /* ignore */ }
  document.querySelectorAll<HTMLElement>(".bgbtn").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === id);
  });
  const g = document.getElementById("grass");
  if (g) buildGrass(g);
}

// ---- Benachrichtigungen ----
const NOTIFY_KEY = "tamagotchi.notify";
let notifyEnabled = false;
try { notifyEnabled = localStorage.getItem(NOTIFY_KEY) === "1"; } catch { /* ignore */ }
let lastNotify = 0;

// ---- Sound ----
const SOUND_KEY = "***";
let soundOn = true;
try { soundOn = localStorage.getItem(SOUND_KEY) !== "0"; } catch { /* ignore */ }
function updateSoundLabel(): void {
  const el = document.getElementById("sound-state");
  if (el) el.textContent = soundOn ? "on" : "off";
}

function updateNotifyLabel(): void {
  const el = document.getElementById("notify-state");
  if (el) el.textContent = notifyEnabled ? "on" : "off";
}

async function notify(title: string, body: string): Promise<void> {
  if (!notifyEnabled || !("Notification" in window) || Notification.permission !== "granted") return;
  const now = Date.now();
  if (now - lastNotify < 60_000) return;
  lastNotify = now;
  const opts: NotificationOptions = { body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: "tamagotchi" };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, opts);
    else new Notification(title, opts);
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
      const label = document.createElement("span");
      label.textContent = t.id.charAt(0).toUpperCase() + t.id.slice(1);
      item.append(b, label);
      bgbtns.appendChild(item);
    }
    applyBg(localStorage.getItem(BG_KEY) ?? "day");
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
    shellStage.appendChild(clone);
    miniDevice = clone;
    const cvs = clone.querySelectorAll("canvas");
    miniTop = cvs[0] ?? null; miniLcd = cvs[1] ?? null; miniBottom = cvs[2] ?? null;
    miniTopCtx = miniTop ? miniTop.getContext("2d") : null;
    miniLcdCtx = miniLcd ? miniLcd.getContext("2d") : null;
    miniBottomCtx = miniBottom ? miniBottom.getContext("2d") : null;
  }
  if (shellbtns && deviceEl) {
    const setShell = (id: string) => {
      applyShell(deviceEl, id, localStorage);
      if (miniDevice) miniDevice.dataset.shell = id;
      document.querySelectorAll<HTMLElement>(".shellbtn").forEach((el) => el.classList.toggle("active", el.dataset.id === id));
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
    setShell(initial);
  }

  const menu = document.getElementById("menu");
  const menuBtn = document.getElementById("btn-menu");
  const scrim = document.getElementById("scrim");
  const closeMenu = () => {
    if (menu) menu.hidden = true;
    if (scrim) scrim.hidden = true;
    menuBtn?.setAttribute("aria-expanded", "false");
  };
  const openMenu = () => {
    if (menu) menu.hidden = false;
    if (scrim) scrim.hidden = false;
    menuBtn?.setAttribute("aria-expanded", "true");
  };
  document.getElementById("menu-close")?.addEventListener("click", closeMenu);
  scrim?.addEventListener("click", closeMenu);
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
  document.getElementById("btn-cancel")?.addEventListener("click", () => { if (modal) modal.hidden = true; });
  modal?.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeMenu(); if (modal) modal.hidden = true; } });
  document.getElementById("btn-confirm-reset")?.addEventListener("click", () => {
    try { localStorage.removeItem("tamagotchi.emu.v1"); } catch { /* ignore */ }
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

  const y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());

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

// Kalibriert: ~5,648 TamaLIB-Zeitstempel-Einheiten pro CPU-Schritt.
// Zeitstempel sind in 1/32768 s (E0C6S46 @ 32768 Hz) → Echtzeit = 32768 Einheiten/s.
const TS_FREQ = 32768;
const TS_PER_STEP = 5.648;
const STEPS_PER_SECOND = Math.round(TS_FREQ / TS_PER_STEP); // nur Startschätzung
const UNITS_PER_MS = TS_FREQ / 1000; // 32.768
const MAX_STEPS_PER_FRAME = 120 * STEPS_PER_SECOND;
const MAX_FRAME_CATCHUP_S = 120;
const MAX_CATCHUP_S = 2 * 3600; // höchstens 2 h nachholen
// Ziel-Emulatorzeit (in TamaLIB-Zeitstempel-Einheiten). Wir steppen, bis der
// Emulator diese Zeit erreicht hat – so bleibt die Uhr exakt in Echtzeit,
// unabhängig davon, wie viele Schritte eine Zeiteinheit braucht.
let targetUnits = 0;

function catchUp(maxSteps: number): void {
  if (!emu) return;
  let budget = maxSteps;
  let guard = 0;
  while (budget > 0 && guard++ < 2000) {
    const remaining = targetUnits - emu.now();
    if (remaining <= 0) break;
    const steps = remaining < 2000 ? 1 : Math.min(budget, Math.round(remaining / TS_PER_STEP), 200000);
    emu.step(steps);
    budget -= steps;
  }
}

let emu: Emulator | null = null;
let iconImgs: IconImages = [];
let lastTs = 0;
let saveTick = 0;
let booted = false;

function saveNow(): void {
  if (SPEED !== 1 || !emu) return;
  const state = emu.saveState();
  void saveEmu(localStorage, state).catch(() => { /* Quota */ });
}

async function boot(): Promise<void> {
  const [wasm, romBuf] = await Promise.all([
    fetch("/emu/tamalib.wasm").then((r) => r.arrayBuffer()),
    fetch("/emu/rom0.bin").then((r) => r.arrayBuffer()),
  ]);
  emu = await createEmulator({ wasm, rom: new Uint8Array(romBuf) });
  iconImgs = await loadIcons();
  if (params.has("debug")) {
    const w = window as unknown as { __emu: Emulator; __notify: (t: string, b: string) => Promise<void> };
    w.__emu = emu;
    w.__notify = notify;
  }

  let saved: Awaited<ReturnType<typeof loadEmu>> = null;
  if (SPEED === 1) {
    saved = await loadEmu(localStorage);
    if (saved) {
      try { emu.loadState(saved.bytes); } catch { /* inkompatibler Save */ }
    }
  }
  targetUnits = emu.now();
  if (saved?.at) {
    const elapsedSec = Math.min(MAX_CATCHUP_S, Math.max(0, (Date.now() - saved.at) / 1000));
    targetUnits += elapsedSec * TS_FREQ;
  }
  // Aufholen sofort erledigen (Lade-Screen bleibt bis dahin), Rest im Loop.
  {
    const t0 = performance.now();
    while (emu.now() < targetUnits && performance.now() - t0 < 1500) catchUp(300000);
  }

  bindButtons();
  lastTs = performance.now();
  // Robust speichern: beim Verlassen/Verstecken der Seite sofort sichern.
  window.addEventListener("pagehide", saveNow);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveNow(); });
  requestAnimationFrame(frame);
}

function bindButtons(): void {
  const unlock = () => piezo.unlock();
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });

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

  window.addEventListener("keydown", (e) => { const b = handleKey(e.key); if (b) set(b, true); });
  window.addEventListener("keyup", (e) => { const b = handleKey(e.key); if (b) set(b, false); });
}

function frame(ts: number): void {
  if (!emu) return;
  if (STATIC > 0) {
    emu.step(STATIC);
  } else {
    const dt = Math.max(0, ts - lastTs);
    lastTs = ts;
    targetUnits += dt * UNITS_PER_MS * SPEED;
    const maxUnits = MAX_FRAME_CATCHUP_S * 1000 * UNITS_PER_MS;
    if (targetUnits - emu.now() > maxUnits) targetUnits = emu.now() + maxUnits;
    catchUp(MAX_STEPS_PER_FRAME);
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
    void notify("Your Tamagotchi needs you", "It's calling — feed it, clean up or play.");
  }

  // periodisch speichern (alle ~5s)
  if (SPEED === 1 && STATIC === 0 && ++saveTick % 300 === 0) {
    void saveEmu(localStorage, emu.saveState()).catch(() => { /* Quota */ });
  }
  if (!booted && targetUnits - emu.now() < 1) { booted = true; loadingEl?.classList.add("hidden"); }
  if (STATIC === 0) requestAnimationFrame(frame);
}

// Im Hintergrund weiterlaufen lassen und bei Rufen benachrichtigen.
setInterval(() => {
  if (!document.hidden || !emu || SPEED !== 1) return;
  const now = performance.now();
  const dt = Math.min((now - lastTs) / 1000, 3600);
  lastTs = now;
  targetUnits += dt * TS_FREQ;
  catchUp(MAX_STEPS_PER_FRAME);
  if (emu.takeBuzzer() && (!document.hasFocus() || document.hidden)) {
    void notify("Your Tamagotchi needs you", "It's calling — feed it, clean up or play.");
  }
}, 5000);

boot();
