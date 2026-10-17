// Wiedergabe des verlustfreien Ton-Ereignisstroms im Browser — auf der
// **AudioContext-Uhr** (`ctx.currentTime`).
//
// Der Server schickt pro Abtastung ein Batch `{t:"tones", ev:[{at,freq,play},…]}`
// — jede Piezo-Transition mit dem *Emulator*-Zeitstempel (`at`, µs) des Moments,
// in dem sie passierte. Diese Zeitachse ist die Uhr des Servers, nicht die des
// Tabs; der Tab darf sie nicht als Wanduhr deuten (sonst verschöben sich Töne um
// die Netzlaufzeit). Deshalb plant der Replayer jedes Ereignis relativ zum
// **ersten** Ereignis des Batches ein: `at - at0` ist, wie lange nach dem ersten
// Ton der nächste kommen soll.
//
// **Warum die AudioContext-Uhr und nicht `setTimeout`:** ein `setTimeout(fn, ms)`
// feuert *frühestens* nach `ms`, nie zeitgenau — die Task-Queue kann das Feuer um
// mehrere Millisekunden schieben (gemessen: bis ~4 ms pro Hop). Eine geplante
// Wanduhr-Verzögerung kollabiert deshalb den 15-µs-Blitz und einen 1-ms-Abstand
// zu einem einzigen Klick und streckt einen Batch über die echte Tonlänge hinaus.
// `ctx.currentTime` ist dagegen die Abtastuhr des Audiografen (128 Samples/Block,
// ~2,7 ms bei 48 kHz); WebAudio-Ramping ist auf ihr **sample-accurate**. Der
// Replayer rechnet darum aus jedem `at`-Delta eine ABSOLUTE AudioContext-Zeit
// (`at0Sec + (at - at0)/1e6`) und übergibt sie der Senke, die den Oszillator bzw.
// die Gain genau dort rampt (`osc.start(t)`, `setValueAtTime(…, t)`).
//
// Der Anker (`at0Sec`) ist der `nowSec()`-Wert beim Eintreffen des Batches. Er
// wird nie in die Vergangenheit gelegt: liegt die Uhr bereits hinter einer
// geplanten Position (der Batch kam verspätet an), wird auf „jetzt" geklemmt —
// der Ton kommt dann sofort statt um die Ankunftslatenz verschoben. Ein
// abgelaufener Blitz wird nicht nachgeholt, ein laufender Chirp nicht gestreckt.
//
// Die Logik ist DOM-frei (die Senke ist `update(freq, on, atSec)`, die Uhr ist
// injizierbar) und damit ohne Browser testbar.



/**
 * Structural copy of the wire tone event. Declared locally so this module —
 * which the server build (`tsconfig.server.json`, include `src/emu`) also
 * compiles — does not pull `src/net/live.ts` (a browser-only module with
 * extensionless client imports) into the Node graph. The two shapes are
 * identical, so a `ToneEventLike` is assignable here and vice versa.
 */
export interface ToneEventLike {
  at: number;
  freq: number;
  play: boolean;
}

/** Was der Replayer mit einer Transition tut (der WebAudio-Piezo in Produktion). */
export interface ToneSink {
  /**
   * Setzt den Piezo-Pegel **auf der AudioContext-Uhr**. `freq` sind die rohen
   * Glue-Einheiten (dHz, 0 = keine), `play` das Enable-Flag — exakt das, was
   * `buzzer()` liefert. `atSec` ist die *absolute* WebAudio-Zeit, zu der die
   * Transition hörbar werden soll (Sekunden, `ctx.currentTime`-Achse). Die
   * Umrechnung nach Hz und das Ramping übernimmt die Senke (`emu/audio.ts`),
   * damit beide Pfade byte-identisch bleiben.
   */
  update(freq: number, on: boolean, atSec: number): void;
}

export interface ToneReplayerOptions {
  /** Senke für jede geplante Transition (der Piezo). */
  sink: ToneSink;
  /**
   * Weckt die Senke zu einer geplanten absoluten AudioContext-Zeit. Defaults zu
   * `setTimeout`, **nur als Wecker** — die *hörbare* Zeit ist `atSec`, der
   * Wecker darf ruhig zu spät feuern. Injizierbar, damit ein Test die Planung
   * ohne echte Zeit beobachten kann.
   */
  schedule?: (fn: () => void, atSec: number) => number;
  /** Bricht eine geplante Verzögerung ab. Defaults zu `clearTimeout`. */
  cancel?: (handle: number) => void;
  /** AudioContext-Uhr in Sekunden; Defaults zu `AudioContext.currentTime`. */
  nowSec?: () => number;
}

/** Ein Ereignis samt bereits berechneter AudioContext-Position. */
export interface PlannedToneAt {
  /** Absolute AudioContext-Zeit in Sekunden. */
  atSec: number;
  freq: number;
  play: boolean;
}

/** Ein Ereignis samt relativer Verzögerung (reine Rechnung, Diagnose/Tests). */
export interface PlannedTone {
  /** Verzögerung in ms gegenüber dem Anker des Batches (>= 0). */
  delayMs: number;
  freq: number;
  play: boolean;
}

/**
 * Rechnet ein Batch in *absolute* AudioContext-Zeiten um.
 *
 * Der Anker ist `at0Sec` (die Uhr beim Eintreffen des Batches); jedes Ereignis
 * bekommt `at0Sec + (at - at0)/1e6` Sekunden. Die Emulator-Zeit läuft in µs,
 * daher der Faktor 1e6. Negative oder nicht-endliche Deltas (eine verletzte
 * Monotonie sollte der Client schon verworfen haben) werden auf 0 geklemmt,
 * damit die Reihenfolge intakt bleibt. Die absolute Position wird **nie** unter
 * `at0Sec` gedrückt — der Anker ist eine Untergrenze, keine Vergangenheit.
 * Pure Funktion, damit Tests die Zeitrechnung ohne Timer prüfen können.
 */
export function planTonesAt(ev: ToneEventLike[], at0Sec: number): PlannedToneAt[] {
  if (ev.length === 0) return [];
  const at0 = ev[0].at;
  const out: PlannedToneAt[] = [];
  for (const e of ev) {
    const deltaUs = e.at - at0;
    const deltaSec = deltaUs > 0 && Number.isFinite(deltaUs) ? deltaUs / 1_000_000 : 0;
    out.push({ atSec: at0Sec + deltaSec, freq: e.freq, play: e.play });
  }
  return out;
}

/**
 * Wie `planTonesAt`, aber mit relativen Millisekunden — die reine Batch-Form,
 * ohne Uhr. Bleibt für Diagnose und die E2E-Prüfung des Stempel-Stroms erhalten.
 */
export function planTones(ev: ToneEventLike[]): PlannedTone[] {
  return planTonesAt(ev, 0).map((p) => ({
    delayMs: p.atSec * 1000,
    freq: p.freq,
    play: p.play,
  }));
}

/**
 * Plant und spielt einen Batch verlustfreier Ton-Transitionen ein.
 *
 * `play(ev)` bricht alle noch ausstehenden, früher geplanten Transitionen ab
 * (ein neuer Batch ist die neuere Wahrheit) und plant dann jede Transition des
 * Batches auf ihrer absoluten AudioContext-Zeit ein. Alle Zeiten liegen beim
 * oder nach dem Anker (`nowSec()`); ein Ereignis, dessen Position die Uhr schon
 * passiert hat, wird sofort auf dem Piezo gesetzt, statt in die Vergangenheit zu
 * zielen (WebAudio verwirft Vergangenes). `stop()` bricht alles ab (z. B. beim
 * Verbindungsabriss, damit ein Ton nicht endlos weiterklingt).
 *
 * Der Replayer hält nur die Wecker-Handles des aktuellen Batches; die Senke ist
 * der einzige Seiteneffekt, also ist die Klasse ohne Browser voll testbar.
 */
export class ToneReplayer {
  private readonly sink: ToneSink;
  private readonly schedule: (fn: () => void, atSec: number) => number;
  private readonly cancel: (handle: number) => void;
  private readonly nowSec: () => number;
  private pending: number[] = [];

  constructor(opts: ToneReplayerOptions) {
    this.sink = opts.sink;
    this.nowSec =
      opts.nowSec ??
      (() => {
        const w = globalThis as { __audioCtxNow?: () => number };
        if (typeof w.__audioCtxNow === "function") return w.__audioCtxNow();
        return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
      });
    // Der Wecker ist die Wanduhr: `atSec` ist eine AudioContext-Zeit, die in
    // einen `performance.now()`-Offset umgerechnet wird. Er dient nur dem
    // Auslösen — die hörbare Zeit setzt die Senke aus `atSec` selbst.
    this.schedule =
      opts.schedule ??
      ((fn, atSec) => {
        const nowSec = this.nowSec();
        const delayMs = Math.max(0, (atSec - nowSec) * 1000);
        return setTimeout(fn, delayMs) as unknown as number;
      });
    this.cancel = opts.cancel ?? ((h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>));
  }

  /**
   * Spielt einen Batch. Der Anker ist der momentane `nowSec()`-Wert, daher
   * klingt das erste Ereignis sofort und jedes weitere auf seiner absoluten
   * AudioContext-Position. Vorherige, noch nicht ausgeführte Transitionen
   * werden verworfen.
   *
   * Batches sind lückenlos: der Server drainiert den Ring bei jeder Abtastung,
   * also schließt `at0` eines Batches direkt an das letzte Ereignis des vorigen
   * an. Da der Client den vorigen Batch bereits „in Echtzeit“ abgespielt hat,
   * ist der neue Anker genau die Ankunftszeit — der erste Event klingt sofort.
   */
  play(ev: ToneEventLike[]): void {
    this.stop();
    const at0Sec = this.nowSec();
    const planned = planTonesAt(ev, at0Sec);
    for (const p of planned) {
      if (p.atSec <= at0Sec) {
        // Keine Vergangenheit planen: das Ereignis liegt auf oder vor dem Anker
        // (erster Event bzw. ein bereits abgelaufener Blitz) — sofort spielen.
        this.sink.update(p.freq, p.play, at0Sec);
        continue;
      }
      // Use a mutable cell so the timer callback can find its own handle even
      // when a test double schedules synchronously (the handle is assigned
      // before `schedule` may invoke `fn` in the real async contract).
      const cell: { handle: number | null } = { handle: null };
      const handle = this.schedule(() => {
        if (cell.handle !== null) this.forget(cell.handle);
        this.sink.update(p.freq, p.play, p.atSec);
      }, p.atSec);
      cell.handle = handle;
      this.pending.push(handle);
    }
  }

  /** Drop a handle from the pending set (fired or cancelled). */
  private forget(handle: number): void {
    const i = this.pending.indexOf(handle);
    if (i >= 0) this.pending.splice(i, 1);
  }

  /** Bricht alle ausstehenden Transitionen ab (Stille, z. B. offline). */
  stop(): void {
    for (const h of this.pending) this.cancel(h);
    this.pending = [];
  }

  /** Anzahl noch ausstehender geplanter Transitionen (Tests/Diagnose). */
  pendingCount(): number {
    return this.pending.length;
  }

  /** AudioContext-Anker in Sekunden (Diagnose/Tests). */
  anchor(): number {
    return this.nowSec();
  }
}
