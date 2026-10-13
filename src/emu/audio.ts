/** Piezo-Ausgabe des Emulators → WebAudio (Square-Wave). */
export interface Piezo {
  update(freq: number, on: boolean): void;
  setMuted(muted: boolean): void;
  unlock(): void;
  /** Diagnose: aktueller Audio-Zustand (fuer Debug/Console). */
  state(): { created: boolean; unlocked: boolean; muted: boolean; ctxState: string; freq: number };
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
    unlock() {
      // AudioContext muss IN der Nutzer-Geste erzeugt/resumed werden. Wird er
      // erst spaeter beim ersten Ton (ausserhalb der Geste) angelegt, bleibt er
      // "suspended" und es kommt nie ein Ton heraus.
      unlocked = true;
      try {
        ensure();
        if (ctx && ctx.state === "suspended") void ctx.resume();
      } catch { /* Audio nicht verfügbar */ }
    },
    update(freq, on) {
      // Sicherheitsnetz: Falls der Kontext doch suspended ist (z. B. Tab war lange
      // im Hintergrund), beim naechsten Ton versuchen zu wecken.
      if (ctx && ctx.state === "suspended") void ctx.resume();
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
    /** Nur fuer Diagnose/Debug: aktueller Zustand. */
    state() { return { created: !!ctx, unlocked, muted, ctxState: ctx?.state ?? "none", freq: currentFreq }; },
  };
}
