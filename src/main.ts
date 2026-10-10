import { createClock } from "./engine/clock";
import { advance } from "./engine/simulation";
import { maybeEvolve, checkHidden } from "./engine/lifecycle";
import { applyAction } from "./engine/actions";
import { createRng } from "./engine/rng";
import { createInitialState } from "./engine/state";
import { createFramebuffer, blitToCanvas } from "./render/canvas";
import { renderScreen } from "./render/screen";
import { pressButton, handleKey } from "./input/menus";
import { resolveRound, sessionWon, PLAY_ROUNDS } from "./engine/minigame";
import { createSound } from "./audio/sound";
import { loadState, createAutosave, clearSave } from "./storage/persist";
import type { GameState } from "./engine/types";

const canvas = document.getElementById("lcd") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const clock = createClock();
const sound = createSound(() => new AudioContext());
const autosave = createAutosave(localStorage, 2000);
const rng = createRng((Math.random() * 2 ** 32) >>> 0);

let state: GameState = loadState(localStorage, clock.now(), (Math.random() * 2 ** 32) >>> 0);

function tick(): GameState {
  const now = clock.now();
  state = advance(state, now);
  state = maybeEvolve(state, now);
  state = checkHidden(state);
  return state;
}

function onButton(b: "A" | "B" | "C") {
  const now = clock.now();
  if (!state.alive) return;
  const { state: next, action } = pressButton(state, b, now);
  state = next;
  if (action) state = applyAction(state, action, now);
  // Play-Minigame: 5 Runden, Gegner per RNG; Sieg ≥3 Runden ⇒ +1 Happy.
  if (state.menu.mode === "play" && (b === "A" || b === "B")) {
    const [rStr, wStr] = (state.menu.sub ?? "0:0").split(":");
    let round = Number(rStr), wins = Number(wStr);
    const player = b === "A" ? "left" : "right";
    const { win } = resolveRound(player, rng);
    round += 1;
    if (win) wins += 1;
    if (round >= PLAY_ROUNDS) {
      state = applyAction(state, { type: "play", result: sessionWon(wins) ? "win" : "lose" }, now);
      state.menu.mode = "idle";
      state.menu.sub = null;
    } else {
      state.menu.sub = `${round}:${wins}`;
    }
  }
  sound.play("click", state.soundOn);
  autosave.schedule(() => state);
}

const held = new Set<string>();
function onCombo() {
  if (held.has("a") && held.has("c")) {
    if (!state.alive) {
      state = createInitialState(clock.now(), (Math.random() * 2 ** 32) >>> 0);
      clearSave(localStorage);
    } else {
      state = { ...state, soundOn: sound.toggle() };
    }
  }
}

function bindButtons() {
  (["a", "b", "c"] as const).forEach((id) => {
    const el = document.getElementById(`btn-${id}`)!;
    el.addEventListener("pointerdown", () => {
      held.add(id);
      onButton(id.toUpperCase() as "A" | "B" | "C");
      onCombo();
    });
    el.addEventListener("pointerup", () => held.delete(id));
  });
  window.addEventListener("keydown", (e) => {
    const b = handleKey(e.key);
    held.add(e.key.toLowerCase());
    if (b) onButton(b);
    onCombo();
  });
  window.addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
}

function frame() {
  const now = clock.now();
  // Uhr-Set-Mode pausiert die Simulation.
  if (state.menu.mode !== "clockSet") tick();
  const fb = createFramebuffer();
  renderScreen(fb, state, now);
  const scale = Math.max(1, Math.floor(canvas.clientWidth / fb.width));
  canvas.width = fb.width * scale;
  canvas.height = fb.height * scale;
  blitToCanvas(ctx, fb, scale);
  requestAnimationFrame(frame);
}

bindButtons();
frame();

export { onButton, tick };
