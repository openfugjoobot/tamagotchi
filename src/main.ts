import { createEmulator, LCD_WIDTH, LCD_HEIGHT } from "./emu/emulator";
import type { Emulator } from "./emu/emulator";
import { drawLcd } from "./render/lcd";
import { drawIconRow, loadIcons, type IconImages } from "./render/icons";
import { handleKey, BUTTON_MAP, type LogicalButton } from "./emu/input";
import { createPiezo } from "./emu/audio";
import { saveEmu, loadEmu } from "./storage/persist";

const canvas = document.getElementById("lcd") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const iconsTop = document.getElementById("icons-top") as HTMLCanvasElement;
const iconsBottom = document.getElementById("icons-bottom") as HTMLCanvasElement;
const ctxTop = iconsTop.getContext("2d")!;
const ctxBottom = iconsBottom.getContext("2d")!;
const piezo = createPiezo(() => new AudioContext());
const loadingEl = document.getElementById("loading");

const params = new URLSearchParams(location.search);
const SPEED = Math.max(1, Number(params.get("speed") ?? "1") || 1);
// Testmodus: feste Schrittzahl, ein Frame, dann Stopp (kein rAF-Loop).
const STATIC = Number(params.get("static") ?? "0") || 0;
const shell = params.get("shell");
if (shell === "pink" || shell === "blue") {
  document.getElementById("device")!.className = `shell-${shell}`;
}

// ---- Hintergrund-Themes ----
const BG_KEY = "tamagotchi.bg";
const THEMES: { id: string; c: string }[] = [
  { id: "navy", c: "#173a5c" },
  { id: "midnight", c: "#14161f" },
  { id: "sunset", c: "#6a2b53" },
  { id: "forest", c: "#17402c" },
  { id: "paper", c: "#e9e4d8" },
];
function applyBg(id: string): void {
  document.body.dataset.bg = id;
  try { localStorage.setItem(BG_KEY, id); } catch { /* ignore */ }
  document.querySelectorAll<HTMLElement>(".bgbtn").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === id);
  });
}

// ---- Guide: the 8 icons (names only) ----
const ICON_NAMES = ["Food", "Light", "Game", "Medicine", "Bath", "Status", "Discipline", "Attention"];

function initUI(): void {
  const bgbtns = document.getElementById("bgbtns");
  if (bgbtns) {
    for (const t of THEMES) {
      const b = document.createElement("button");
      b.className = "bgbtn";
      b.dataset.id = t.id;
      b.style.background = t.c;
      b.title = t.id;
      b.setAttribute("aria-label", "Hintergrund " + t.id);
      b.addEventListener("click", () => applyBg(t.id));
      bgbtns.appendChild(b);
    }
    applyBg(localStorage.getItem(BG_KEY) ?? "navy");
  }

  const grid = document.getElementById("icon-grid");
  if (grid) {
    ICON_NAMES.forEach((name, i) => {
      const card = document.createElement("article");
      card.className = "icon-card";
      const img = document.createElement("img");
      img.src = `/emu/icons/${i}.png`;
      img.alt = name;
      const h3 = document.createElement("h3");
      h3.textContent = name;
      card.append(img, h3);
      grid.appendChild(card);
    });
  }

  const menu = document.getElementById("menu");
  const menuBtn = document.getElementById("btn-menu");
  const closeMenu = () => { if (menu) menu.hidden = true; menuBtn?.setAttribute("aria-expanded", "false"); };
  menuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!menu) return;
    menu.hidden = !menu.hidden;
    menuBtn.setAttribute("aria-expanded", String(!menu.hidden));
  });
  document.addEventListener("click", (e) => {
    if (menu && !menu.hidden && e.target instanceof Node && !menu.contains(e.target) && e.target !== menuBtn) closeMenu();
  });
  document.getElementById("menu-guide")?.addEventListener("click", () => {
    closeMenu();
    document.getElementById("guide")?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  const y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());
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
  if (params.has("debug")) (window as unknown as { __emu: Emulator }).__emu = emu;

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

  const b = emu.buzzer();
  piezo.update(b.freq, b.on);

  // periodisch speichern (alle ~5s)
  if (SPEED === 1 && STATIC === 0 && ++saveTick % 300 === 0) {
    void saveEmu(localStorage, emu.saveState()).catch(() => { /* Quota */ });
  }
  if (!booted && pendingSteps < 1) { booted = true; loadingEl?.classList.add("hidden"); }
  if (STATIC === 0) requestAnimationFrame(frame);
}

boot();
