import type { GameState } from "./types";
import { config } from "./config";

const MAX_STEPS = 10_000;

function decayRates(state: GameState) {
  switch (state.stage) {
    case "BABY": return config.decay.baby;
    case "CHILD": return config.decay.child;
    case "TEEN": return config.decay.teen;
    default: return config.decay.adult;
  }
}

export function deviceMinutes(state: GameState, nowMs: number): number {
  const totalMin = Math.floor(nowMs / 60_000) + state.clock.offsetMinutes;
  return ((totalMin % 1440) + 1440) % 1440;
}

export function isSleepTime(state: GameState, nowMs: number): boolean {
  const c = state.character;
  if (!c) return false;
  const win = config.sleep.byCharacter[c];
  if (!win) return false;
  const m = deviceMinutes(state, nowMs);
  return win.from > win.to ? (m >= win.from || m < win.to) : (m >= win.from && m < win.to);
}

export function advance(state: GameState, nowMs: number): GameState {
  if (!state.alive) return state;
  const s: GameState = structuredClone(state);
  let cursor = s.lastTickAt;
  let steps = 0;

  while (cursor < nowMs && steps++ < MAX_STEPS) {
    const next = nextBoundary(s, cursor, nowMs);
    applyInterval(s, cursor, next);
    cursor = next;
  }
  s.lastTickAt = nowMs;
  checkDeath(s, nowMs);
  return s;
}

function nextBoundary(s: GameState, from: number, to: number): number {
  let b = to;
  if (s.nextPoopAt > from && s.nextPoopAt < b) b = s.nextPoopAt;
  if (s.nextCallAt > from && s.nextCallAt < b) b = s.nextCallAt;
  if (s.sickSince !== null && s.sickSince + config.lifespan.sicknessDeathMs < b) {
    b = s.sickSince + config.lifespan.sicknessDeathMs;
  }
  return Math.max(from + 1, b);
}

function applyInterval(s: GameState, from: number, to: number) {
  const dt = to - from;
  if (dt <= 0) return;
  if (!s.flags.sleeping) {
    const rates = decayRates(s);
    applyDecay(s, "hungry", rates.hungryMs, dt);
    applyDecay(s, "happy", rates.happyMs, dt);
  } else {
    // Im Schlaf kein Herzverlust; Bruch-Rest bleibt unverändert.
  }
  if (s.poops < config.poop.max && s.nextPoopAt <= to) {
    s.poops += 1;
    s.lastPoopAt = to;
    const iv = config.poop.intervalByStage[s.stage] ?? 3 * 60 * 60_000;
    s.nextPoopAt = to + iv;
  }
  updateSleep(s, to);
  updateSickness(s, to);
  updateCalls(s, to);
  updateAttention(s, to);
}

function applyDecay(s: GameState, key: "hungry" | "happy", rate: number, dt: number) {
  const acc = s.decayCarry[key === "hungry" ? "hungryMs" : "happyMs"] + dt;
  const lost = Math.floor(acc / rate);
  s.decayCarry[key === "hungry" ? "hungryMs" : "happyMs"] = acc % rate;
  if (lost <= 0) return;
  s[key] = Math.max(0, s[key] - lost);
}

function updateSleep(s: GameState, nowMs: number) {
  const shouldSleep = isSleepTime(s, nowMs);
  if (shouldSleep && !s.flags.sleeping) {
    s.flags.sleeping = true;
  } else if (!shouldSleep && s.flags.sleeping) {
    s.flags.sleeping = false;
    s.ageYears += config.age.yearsOnWake;
  }
}

function updateSickness(s: GameState, nowMs: number) {
  const babyDue = s.character === "babytchi" && !s.sickedThisStage &&
    nowMs >= s.bornAt + config.lifespan.babySicknessMs;
  const poopDue = s.poops >= config.poop.max;
  if ((babyDue || poopDue) && !s.flags.sick) {
    s.flags.sick = true;
    s.sickSince = nowMs;
    s.sickedThisStage = true;
  }
}

function updateAttention(s: GameState, nowMs: number) {
  if (s.hungry === 0 || s.happy === 0) {
    if (!s.flags.attention) {
      s.flags.attention = true;
      s.attentionSince = nowMs;
      s.attentionReason = s.hungry === 0 ? "hungry" : "happy";
    }
  }
  // Unbeantworteter Call nach Ablauf des Fensters ⇒ Care Mistake.
  if (s.flags.attention && s.attentionSince !== null &&
      nowMs - s.attentionSince >= config.attention.careMistakeWindowMs) {
    s.careMistakes += 1;
    s.careMistakesThisStage += 1;
    s.flags.attention = false;
    s.flags.misbehaving = false;
    s.attentionSince = null;
    s.attentionReason = null;
  }
}

// Regelmäßige Rufe: bei leerem Herz ein Bedürfnis-Ruf, sonst „misbehaving“.
function updateCalls(s: GameState, nowMs: number) {
  while (s.nextCallAt <= nowMs) {
    const needEmpty = s.hungry === 0 || s.happy === 0;
    if (!needEmpty && !s.flags.sleeping && !s.flags.attention) {
      s.flags.attention = true;
      s.attentionSince = s.nextCallAt;
      s.attentionReason = "misbehave";
      s.flags.misbehaving = true;
    }
    s.nextCallAt += config.attention.callIntervalMs;
  }
}

function checkDeath(s: GameState, nowMs: number) {
  if (s.flags.sick && s.sickSince !== null &&
      nowMs - s.sickSince >= config.lifespan.sicknessDeathMs) {
    s.alive = false; s.stage = "DEAD"; s.deadAt = nowMs; s.causeOfDeath = "sickness";
    return;
  }
  const lifespanDays = Math.max(1,
    config.lifespan.baseDays - s.careMistakes * config.lifespan.daysLostPerCareMistake);
  if (s.ageYears >= lifespanDays) {
    s.alive = false; s.stage = "DEAD"; s.deadAt = nowMs; s.causeOfDeath = "age";
  }
}
