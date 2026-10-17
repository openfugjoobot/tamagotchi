/** Piezo-Ausgabe des Emulators → WebAudio (Square-Wave). */
export interface Piezo {
  update(freq: number, on: boolean): void;
  setMuted(muted: boolean): void;
  unlock(): void;
  /** Diagnose: aktueller Audio-Zustand (fuer Debug/Console). */
  state(): {
    created: boolean;
    unlocked: boolean;
    muted: boolean;
    ctxState: string;
    freq: number;
    /** Anzahl der Toneinsaetze (= frische On-Flanken) seit Erzeugung. */
    articulations: number;
  };
}

export function createPiezo(createCtx: () => AudioContext): Piezo {
  let ctx: AudioContext | null = null;
  let osc: OscillatorNode | null = null;
  let gain: GainNode | null = null;
  let muted = false;
  let unlocked = false;
  let currentFreq = 0;
  /**
   * Klingt der Piezo gerade *hörbar*? Trennt "noch derselbe Ton" von "ein
   * neuer, gleich klingender Ton". Der Server schickt nur den Pegel (freq/on)
   * und nur bei Änderung; zwei gleiche Chirps kommen als on→off→on an. Ohne
   * dieses Flag könnte ein zweiter, gleich hoher Chirp nicht von einem
   * durchgehenden Ton unterschieden werden.
   */
  let sounding = false;
  /** Zähler frischer Toneinsätze (Diagnose/Tests). */
  let articulations = 0;

  const ensure = () => {
    if (ctx) return;
    ctx = createCtx();
    gain = ctx.createGain();
    osc = ctx.createOscillator();
    osc.type = "square";
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    // Leiser Dauerlauf-Hüllkurve-Knoten; der Ton wird über die Verstärkung
    // an- und abgeschaltet, der Oszillator läuft (bis zu einem Re-Artikulation).
    osc.start();
  };

  /** Startet die Wellenform neu, damit die Phase zurückgesetzt wird. */
  const reattack = (): void => {
    if (!ctx || !osc || !gain) return;
    try {
      // Den laufenden Oszillator ersetzen: nur so beginnt der frische Chirp mit
      // Phase 0 und ist als eigener Ton hörbar (sonst verschmieren zwei gleiche
      // Chirps zu einem durchgehenden Ton).
      try { osc.stop(); } catch { /* schon gestoppt */ }
      osc.disconnect();
      osc = ctx.createOscillator();
      osc.type = "square";
      osc.connect(gain);
      osc.start();
    } catch { /* Audio nicht verfügbar */ }
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
        sounding = false;
        return;
      }
      try {
        ensure();
        if (!ctx || !osc || !gain) return;
        // Emulator-Frequenz ist in dHz → Hz/10.
        const hz = Math.max(20, freq / 10);
        // Frischer Toneinsatz? Nur wenn der Ton vorher *nicht* klang, ist es
        // eine neue Artikulation — dann Wellenform neu starten und Phase
        // zurücksetzen. Solange derselbe Ton durchklingt (sounding bleibt true),
        // wird NICHT neu angeschlagen, sonst klänge jeder 20-ms-Frame wie ein
        // neuer Chirp.
        if (!sounding) {
          articulations++;
          reattack();
          sounding = true;
        }
        if (hz !== currentFreq) { osc.frequency.value = hz; currentFreq = hz; }
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
      } catch { /* Audio nicht verfügbar */ }
    },
    setMuted(m) { muted = m; },
    /** Nur fuer Diagnose/Debug: aktueller Zustand. */
    state() {
      return {
        created: !!ctx,
        unlocked,
        muted,
        ctxState: ctx?.state ?? "none",
        freq: currentFreq,
        articulations,
      };
    },
  };
}
