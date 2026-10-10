export type SoundName = "call" | "click" | "confirm" | "evolve" | "error" | "death";

const TONES: Record<SoundName, { freq: number; ms: number; type: OscillatorType }> = {
  call:    { freq: 880, ms: 120, type: "square" },
  click:   { freq: 440, ms: 40,  type: "square" },
  confirm: { freq: 660, ms: 80,  type: "square" },
  evolve:  { freq: 523, ms: 300, type: "triangle" },
  error:   { freq: 160, ms: 200, type: "sawtooth" },
  death:   { freq: 110, ms: 600, type: "sine" },
};

export function createSound(createCtx: () => AudioContext) {
  let enabled = true;
  let ctx: AudioContext | null = null;
  return {
    play(name: SoundName, on: boolean) {
      if (!on) return;
      try {
        ctx ??= createCtx();
        const t = TONES[name];
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = t.type;
        osc.frequency.value = t.freq;
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + t.ms / 1000);
      } catch { /* Audio nicht verfügbar */ }
    },
    toggle() { enabled = !enabled; return enabled; },
  };
}
