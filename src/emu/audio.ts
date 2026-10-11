/** Piezo-Ausgabe des Emulators → WebAudio (Square-Wave). */
export interface Piezo {
  update(freq: number, on: boolean): void;
  setMuted(muted: boolean): void;
  unlock(): void;
}

export function createPiezo(createCtx: () => AudioContext): Piezo {
  let ctx: AudioContext | null = null;
  let osc: OscillatorNode | null = null;
  let gain: GainNode | null = null;
  let muted = false;
  let unlocked = false;
  let currentFreq = 0;

  const ensure = () => {
    if (ctx) return;
    ctx = createCtx();
    osc = ctx.createOscillator();
    gain = ctx.createGain();
    osc.type = "square";
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
  };

  return {
    unlock() { unlocked = true; try { if (ctx && ctx.state === "suspended") void ctx.resume(); } catch { /* ignore */ } },
    update(freq, on) {
      const audible = on && !muted && freq > 0 && unlocked;
      if (!audible) {
        if (gain && ctx) gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        return;
      }
      try {
        ensure();
        if (!ctx || !osc || !gain) return;
        // Emulator-Frequenz ist in dHz → Hz/10.
        const hz = Math.max(20, freq / 10);
        if (hz !== currentFreq) { osc.frequency.value = hz; currentFreq = hz; }
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
      } catch { /* Audio nicht verfügbar */ }
    },
    setMuted(m) { muted = m; },
  };
}
