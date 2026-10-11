// Emulator-Zeitmodell.
//
// TamaLIB-Zeitstempel laufen in 1/32768 s (E0C6S46-Timer). Kalibriert auf
// ~5,648 Zeitstempel-Einheiten pro CPU-Schritt (siehe docs/ARCHITECTURE.md).
//
// Der Emulator-Zeitstempel selbst ist ein u32 und läuft alle ~36,4 h emulierter
// Zeit über. Deshalb arbeitet der Pacer ausschließlich mit *relativen* Beträgen
// ("wie viele Einheiten sind noch abzuarbeiten") statt mit einem absoluten Ziel –
// so ist der Wrap egal und es gibt kein Zeitlimit mehr.

export const TS_FREQ = 32768; // Zeitstempel-Einheiten pro Sekunde
export const TS_PER_STEP = 5.648; // Einheiten pro CPU-Schritt (kalibriert)
export const UNITS_PER_MS = TS_FREQ / 1000; // 32.768
export const STEPS_PER_SECOND = Math.round(TS_FREQ / TS_PER_STEP); // ~5802

/** Emulator-Einheiten (1/32768 s) für eine reale Dauer in Millisekunden. */
export function unitsForMs(ms: number): number {
  return ms * UNITS_PER_MS;
}

/** Anzahl CPU-Schritte für `units` Emulator-Einheiten (mindestens 1). */
export function stepsForUnits(units: number): number {
  return Math.max(1, Math.round(units / TS_PER_STEP));
}

/**
 * Relative Zeitsteuerung: sammelt "geschuldete" Emulator-Zeit und gibt sie in
 * Schritt-Budgets aus. Alle Beträge sind relativ, daher unabhängig vom u32-Wrap
 * des Emulator-Zeitstempels.
 */
export class Pacer {
  private owed = 0;

  /** Fügt Emulator-Einheiten hinzu (negative/0 werden ignoriert). */
  add(units: number): void {
    if (units > 0) this.owed += units;
  }

  /** Fügt reale Millisekunden hinzu. */
  addMs(ms: number): void {
    this.add(unitsForMs(ms));
  }

  /** Noch abzuarbeitende Emulator-Einheiten. */
  get owedUnits(): number {
    return this.owed;
  }

  /**
   * Verbraucht höchstens `maxSteps` CPU-Schritte und gibt die Schritt-Zahl
   * zurück, die der Aufrufer ausführen soll. Die Schuld wird entsprechend
   * reduziert (nie unter 0).
   */
  take(maxSteps: number): number {
    if (this.owed <= 0 || maxSteps <= 0) return 0;
    const want = stepsForUnits(this.owed);
    const steps = Math.min(want, Math.floor(maxSteps));
    if (steps <= 0) return 0;
    this.owed = Math.max(0, this.owed - steps * TS_PER_STEP);
    return steps;
  }
}
