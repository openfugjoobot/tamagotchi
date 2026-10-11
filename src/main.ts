import { createEmulator, LCD_WIDTH, LCD_HEIGHT } from "./emu/emulator";
import type { Emulator } from "./emu/emulator";
import { drawLcd } from "./render/lcd";
import { drawIconRow } from "./render/icons";
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

const params = new URLSearchParams(location.search);
const SPEED = Math.max(1, Number(params.get("speed") ?? "1") || 1);
// Testmodus: feste Schrittzahl, ein Frame, dann Stopp (kein rAF-Loop).
const STATIC = Number(params.get("static") ?? "0") || 0;
const shell = params.get("shell");
if (shell === "pink" || shell === "blue") {
  document.getElementById("device")!.className = `shell-${shell}`;
}

// Kalibriert: ~5,648 TamaLIB-Zeitstempel-Einheiten pro CPU-Schritt.
// Zeitstempel sind in 1/32768 s (E0C6S46 @ 32768 Hz) → Echtzeit = 32768 Einheiten/s.
const TS_FREQ = 32768;
const TS_PER_STEP = 5.648;
const STEPS_PER_SECOND = Math.round(TS_FREQ / TS_PER_STEP); // ≈ 5802
const MAX_STEPS_PER_FRAME = STEPS_PER_SECOND; // max. ~1s Emulation pro Frame (sanftes Aufholen)
let pendingSteps = 0;

let emu: Emulator | null = null;
let lastTs = 0;
let saveTick = 0;

async function boot(): Promise<void> {
  const [wasm, romBuf] = await Promise.all([
    fetch("/emu/tamalib.wasm").then((r) => r.arrayBuffer()),
    fetch("/emu/rom0.bin").then((r) => r.arrayBuffer()),
  ]);
  emu = await createEmulator({ wasm, rom: new Uint8Array(romBuf) });
  if (params.has("debug")) (window as unknown as { __emu: Emulator }).__emu = emu;

  if (SPEED === 1) {
    const saved = loadEmu(localStorage);
    if (saved) { try { emu.loadState(saved); } catch { /* inkompatibler Save */ } }
  }

  bindButtons();
  lastTs = performance.now();
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
    el.height = 7 * scale;
    drawIconRow(c, icons, row, scale);
  }

  const b = emu.buzzer();
  piezo.update(b.freq, b.on);

  if (SPEED === 1 && STATIC === 0 && ++saveTick % 180 === 0) {
    try { saveEmu(localStorage, emu.saveState()); } catch { /* Quota */ }
  }
  if (STATIC === 0) requestAnimationFrame(frame);
}

boot();
