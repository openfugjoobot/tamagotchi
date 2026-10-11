import { createEmulator, LCD_WIDTH, LCD_HEIGHT } from "./emu/emulator";
import type { Emulator } from "./emu/emulator";
import { drawLcd } from "./render/lcd";
import { handleKey, BUTTON_MAP, type LogicalButton } from "./emu/input";
import { createPiezo } from "./emu/audio";
import { saveEmu, loadEmu } from "./storage/persist";

const canvas = document.getElementById("lcd") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const piezo = createPiezo(() => new AudioContext());

const params = new URLSearchParams(location.search);
const SPEED = Math.max(1, Number(params.get("speed") ?? "1") || 1);
const shell = params.get("shell");
if (shell === "pink" || shell === "blue") {
  document.getElementById("device")!.className = `shell-${shell}`;
}

// Kalibriert: ~5,648 µs emulierte Zeit pro CPU-Schritt → ~177.000 Schritte/s Echtzeit.
const STEPS_PER_SECOND = 177_000;
const MAX_STEPS_PER_FRAME = STEPS_PER_SECOND; // Klemme gegen Riesen-Sprünge

let emu: Emulator | null = null;
let lastTs = 0;
let saveTick = 0;

async function boot(): Promise<void> {
  const [wasm, romBuf] = await Promise.all([
    fetch("/emu/tamalib.wasm").then((r) => r.arrayBuffer()),
    fetch("/emu/rom0.bin").then((r) => r.arrayBuffer()),
  ]);
  emu = await createEmulator({ wasm, rom: new Uint8Array(romBuf) });

  if (SPEED === 1) {
    const saved = loadEmu(localStorage);
    if (saved) { try { emu.loadState(saved); } catch { /* inkompatibler Save */ } }
  }

  bindButtons();
  lastTs = performance.now();
  requestAnimationFrame(frame);
}

function press(btn: LogicalButton, down: boolean): void {
  emu?.setButton(BUTTON_MAP[btn], down);
}

function bindButtons(): void {
  (["a", "b", "c"] as const).forEach((id) => {
    const el = document.getElementById(`btn-${id}`)!;
    const b = id.toUpperCase() as LogicalButton;
    el.addEventListener("pointerdown", () => press(b, true));
    el.addEventListener("pointerup", () => press(b, false));
    el.addEventListener("pointerleave", () => press(b, false));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  });
  window.addEventListener("keydown", (e) => { const b = handleKey(e.key); if (b) press(b, true); });
  window.addEventListener("keyup", (e) => { const b = handleKey(e.key); if (b) press(b, false); });
}

function frame(ts: number): void {
  if (!emu) return;
  const dt = Math.min(ts - lastTs, 100);
  lastTs = ts;
  const steps = Math.min(MAX_STEPS_PER_FRAME, Math.round((dt / 1000) * STEPS_PER_SECOND * SPEED));
  if (steps > 0) emu.step(steps);

  const scale = Math.max(1, Math.floor(canvas.clientWidth / LCD_WIDTH));
  canvas.width = LCD_WIDTH * scale;
  canvas.height = LCD_HEIGHT * scale;
  drawLcd(ctx, emu.lcd(), scale);

  const b = emu.buzzer();
  piezo.update(b.freq, b.on);

  if (SPEED === 1 && ++saveTick % 180 === 0) {
    try { saveEmu(localStorage, emu.saveState()); } catch { /* Quota */ }
  }
  requestAnimationFrame(frame);
}

boot();
