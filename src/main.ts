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
      const b = document.createElement("button");
      b.className = "bgbtn";
      b.dataset.id = t.id;
      b.style.background = t.c;
      b.title = t.id;
      b.setAttribute("aria-label", "Background: " + t.id);
      b.addEventListener("click", () => applyBg(t.id));
      bgbtns.appendChild(b);
    }
    applyBg(localStorage.getItem(BG_KEY) ?? "day");
  }

  const shellbtns = document.getElementById("shellbtns");
  const deviceEl = document.querySelector(".device-wrap") as HTMLElement | null;
  const shellStage = document.getElementById("shell-stage");
  const deviceSrc = document.querySelector(".device-wrap") as HTMLElement | null;
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
const STEPS_PER_SECOND = Math.round(TS_FREQ / TS_PER_STEP); // ≈ 5802
const MAX_STEPS_PER_FRAME = 120 * STEPS_PER_SECOND; // Aufholen: bis 120 s Emulation pro Frame
const MAX_CATCHUP_S = 2 * 3600; // höchstens 2 h nachholen
let pendingSteps = 0;

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

  if (SPEED === 1) {
    const saved = await loadEmu(localStorage);
    if (saved) {
      try { emu.loadState(saved.bytes); } catch { /* inkompatibler Save */ }
      // Wanduhr-Zeit seit dem Speichern nachholen (App war geschlossen).
      if (saved.at) {
        const elapsedSec = Math.min(MAX_CATCHUP_S, Math.max(0, (Date.now() - saved.at) / 1000));
        pendingSteps += elapsedSec * STEPS_PER_SECOND;
      }
    }
  }
  // Aufholen sofort erledigen (Lade-Screen bleibt bis dahin), Rest im Loop.
  {
    const t0 = performance.now();
    while (pendingSteps > 0 && performance.now() - t0 < 1500) {
      const chunk = Math.min(pendingSteps, 300000);
      emu.step(chunk);
      pendingSteps -= chunk;
    }
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
  let steps: number;
  if (STATIC > 0) {
    steps = STATIC;
  } else {
    const dt = Math.max(0, ts - lastTs);
    lastTs = ts;
    // Echtzeit-Fortschritt inkl. Hintergrund: aufgelaufene Schritte nachziehen.
    pendingSteps += (dt / 1000) * STEPS_PER_SECOND * SPEED;
    steps = Math.min(MAX_STEPS_PER_FRAME, Math.floor(pendingSteps));
    pendingSteps -= steps;
  }
  if (steps > 0) emu.step(steps);

  const scale = Math.max(1, Math.floor(canvas.clientWidth / LCD_WIDTH));
  canvas.width = LCD_WIDTH * scale;
  canvas.height = LCD_HEIGHT * scale;
  drawLcd(ctx, emu.lcd(), scale);

  const icons = emu.icons();
  for (const [el, c, row] of [[iconsTop, ctxTop, 0], [iconsBottom, ctxBottom, 1]] as const) {
    el.width = LCD_WIDTH * scale;
    el.height = 8 * scale;
    drawIconRow(c, icons, row, scale, iconImgs);
  }

  // Mini-Vorschau spiegeln
  if (miniLcd && miniLcdCtx) {
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
  if (!booted && pendingSteps < 1) { booted = true; loadingEl?.classList.add("hidden"); }
  if (STATIC === 0) requestAnimationFrame(frame);
}

// Im Hintergrund weiterlaufen lassen und bei Rufen benachrichtigen.
setInterval(() => {
  if (!document.hidden || !emu || SPEED !== 1) return;
  const now = performance.now();
  const dt = Math.min((now - lastTs) / 1000, 3600);
  lastTs = now;
  pendingSteps += dt * STEPS_PER_SECOND;
  const steps = Math.min(MAX_STEPS_PER_FRAME, Math.floor(pendingSteps));
  pendingSteps -= steps;
  if (steps > 0) emu.step(steps);
  if (emu.takeBuzzer() && (!document.hasFocus() || document.hidden)) {
    void notify("Your Tamagotchi needs you", "It's calling — feed it, clean up or play.");
  }
}, 5000);

boot();
