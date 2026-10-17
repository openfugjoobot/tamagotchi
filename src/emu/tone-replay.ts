// Wiedergabe des verlustfreien Ton-Ereignisstroms im Browser.
//
// Der Server schickt pro Abtastung ein Batch `{t:"tones", ev:[{at,freq,play},…]}`
// — jede Piezo-Transition mit dem *Emulator*-Zeitstempel (`at`, µs) des Moments,
// in dem sie passierte. Diese Zeitachse ist die Uhr des Servers, nicht die des
// Tabs; der Tab darf sie nicht als Wanduhr deuten (sonst verschoeben sich Töne
// um die Netzlaufzeit). Deshalb plant der Replayer jedes Ereignis relativ zum
// **ersten** Ereignis des Batches ein: `at - at0` ist, wie lange nach dem ersten
// Ton der nächste kommen soll. Die Wanduhr-Ankerzeit setzt der Aufrufer
// (`performance.now()` ist der Monotonie-Anker), damit die geplante Zeit
// unabhängig von `Date.now()`-Sprüngen bleibt.
//
// Warum überhaupt planen statt sofort spielen: der Abtaster liest alle 20 ms, ein
// Batch kann also mehrere Übergänge enthalten (gemessen: bis zu 2 pro 125-ms-
// Tick, aber ein Burst liefert bis zu sechs: freq-off, on, off, freq-off, on,
// off). Ein Batch einfach sofort durchzuspielen würde die Dauer jedes Chirps auf
// null kollabieren und die Zwei-Ton-Struktur (kurzer Blip + längerer Ton)
// zerstören. Der Replayer gibt jedem Ereignis seine `at`-Distanz als Wanduhr-
// Verzögerung, sodass ein Burst genauso lang klingt, wie er es real tat.
//
// Die Logik ist DOM-frei (nur `update(hz, on)` als Senke) und damit ohne
// Browser testbar.



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
   * Setzt den Piezo-Pegel. `freq` sind die rohen Glue-Einheiten (dHz, 0 =
   * keine), `play` das Enable-Flag — exakt das, was `buzzer()` liefert. Die
   * Umrechnung nach Hz macht die Senke (siehe `emu/audio.ts`), damit beide Pfade
   * byte-identisch bleiben.
   */
  update(freq: number, on: boolean): void;
}

export interface ToneReplayerOptions {
  /** Senke für jede geplante Transition (der Piezo). */
  sink: ToneSink;
  /**
   * Zeitgeber für die Verzögerung. Defaults zu `setTimeout`; injizierbar, damit
   * ein Test die Planung ohne echte Zeit beobachten kann.
   */
  schedule?: (fn: () => void, delayMs: number) => number;
  /** Bricht eine geplante Verzögerung ab. Defaults zu `clearTimeout`. */
  cancel?: (handle: number) => void;
  /** Monotoner Uhrwert in ms; Defaults zu `performance.now()`/`Date.now()`. */
  now?: () => number;
}

/** Ein Ereignis samt bereits berechneter Wanduhr-Verzögerung. */
export interface PlannedTone {
  /** Verzögerung in ms gegenüber dem Anker des Batches (>= 0). */
  delayMs: number;
  freq: number;
  play: boolean;
}

/**
 * Rechnet ein Batch in geplante Transitionen um.
 *
 * Der Anker ist `at` des **ersten** Ereignisses (`at0`); jedes weitere bekommt
 * `(at - at0) / 1000` ms. Die Emulator-Zeit läuft in µs, daher der Faktor 1000.
 * Negative oder nicht-endliche Deltas (eine verletzte Monotonie sollte der Client
 * schon verworfen haben) werden auf 0 geklemmt, damit die Reihenfolge intakt
 * bleibt und nie in die Vergangenheit geplant wird. Pure Funktion, damit Tests die
 * Zeitrechnung ohne Timer prüfen können.
 */
export function planTones(ev: ToneEventLike[]): PlannedTone[] {
  if (ev.length === 0) return [];
  const at0 = ev[0].at;
  const out: PlannedTone[] = [];
  for (const e of ev) {
    const deltaUs = e.at - at0;
    const delayMs = deltaUs > 0 && Number.isFinite(deltaUs) ? deltaUs / 1000 : 0;
    out.push({ delayMs, freq: e.freq, play: e.play });
  }
  return out;
}

/**
 * Plant und spielt einen Batches verlustfreier Ton-Transitionen.
 *
 * `play(ev)` bricht alle noch ausstehenden, früher geplanten Transitionen ab
 * (ein neuer Batch ist die neuere Wahrheit) und plant dann jede Transition des
 * Batches mit ihrer `at`-relativen Verzögerung ein. `stop()` bricht alles ab
 * (z. B. beim Verbindungsabriss, damit ein Ton nicht endlos weiterklingt).
 *
 * Der Replayer hält nur die Timer-Handles des aktuellen Batches; die Senke ist
 * der einzige Seiteneffekt, also ist die Klasse ohne Browser voll testbar.
 */
export class ToneReplayer {
  private readonly sink: ToneSink;
  private readonly schedule: (fn: () => void, delayMs: number) => number;
  private readonly cancel: (handle: number) => void;
  private readonly now: () => number;
  private pending: number[] = [];

  constructor(opts: ToneReplayerOptions) {
    this.sink = opts.sink;
    this.schedule =
      opts.schedule ??
      ((fn, delayMs) => setTimeout(fn, delayMs) as unknown as number);
    this.cancel = opts.cancel ?? ((h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>));
    this.now =
      opts.now ??
      (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  }

  /**
   * Spielt einen Batch. Die Anker-Zeit ist der Moment dieses Aufrufs, daher
   * klingt das erste Ereignis sofort und jedes weitere nach seiner realen
   * Distanz. Vorherige, noch nicht ausgeführte Transitionen werden verworfen.
   *
   * Batches sind lückenlos: der Server drainiert den Ring bei jeder Abtastung,
   * also schließt `at0` eines Batches direkt an das letzte Ereignis des vorigen
   * an. Da der Client den vorigen Batch bereits „in Echtzeit“ abgespielt hat,
   * ist der neue Anker genau die Ankunftszeit — der erste Event klingt sofort.
   * Ein Chirp, der eine Batch-Grenze überspannt, wird damit nicht verschoben:
   * sein zweiter Teil ist der erste Event des neuen Batches und klingt zum
   * selben Anker, an dem der vorige Batch endete.
   */
  play(ev: ToneEventLike[]): void {
    this.stop();
    const planned = planTones(ev);
    for (const p of planned) {
      if (p.delayMs <= 0) {
        // Sofort spielen (kein Timer fuer das erste Ereignis / Gleichzeitiges).
        this.sink.update(p.freq, p.play);
        continue;
      }
      // Use a mutable cell so the timer callback can find its own handle even
      // when a test double schedules synchronously (the handle is assigned
      // before `schedule` may invoke `fn` in the real async contract).
      const cell: { handle: number | null } = { handle: null };
      const handle = this.schedule(() => {
        if (cell.handle !== null) this.forget(cell.handle);
        this.sink.update(p.freq, p.play);
      }, p.delayMs);
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

  /** Monotoner Anker (Diagnose/Tests). */
  anchor(): number {
    return this.now();
  }
}
