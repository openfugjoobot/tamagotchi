# Architektur

Die App ist eine **Full-Stack-Plattform**: das Tamagotchi läuft **auf dem Server**,
der Browser ist nur Fenster und Fernbedienung. Die Emulation ist weiterhin die
**echte Firmware** in TamaLIB (WASM) — es wird nichts nachgebaut.

```
Browser                                  tamagotchi-server (Node)          Postgres
  src/net/live.ts  ──WS /ws────────────▶  server/src/ws.ts                 (pets.state)
   render/lcd.ts   ◀─{t:"frame",lcd(bitpacked,base64),icons?} server/src/emulator.ts (WASM)
   net/lcd-codec.ts ◀── pack/unpack (shared by client + server)
   emu/audio.ts    ◀─{t:"buzzer",freq,on}   server/src/ws.ts (Sampler, 20 ms)
   emu/tone-replay.ts ◀─{t:"tones",ev:[{at,freq,play}]} server/src/ws.ts (verlustfreier Ring)
   ui/*.ts         ──REST /api/*────────▶ server/src/api.ts (Fastify)
                                           server/src/tick.ts (LCD, 125 ms)
                                           server/src/beeps.ts (Debounce)
                                           server/src/push.ts (web-push) ──▶ Push-Service
```

## Rollen

- **Server = Spiel.** Jedes Tier hat eine eigene `PetEmulator`-Instanz mit eigenem
  WASM-Speicher. Der Server kennt die Zeit und treibt alle Tiere in **einem**
  Tick-Loop (`server/src/tick.ts`, 125 ms ≈ 8 fps). Läuft weiter, auch wenn kein
  Browser offen ist.
- **Browser = Client.** `src/net/live.ts` verbindet sich per WebSocket, zeichnet die
  empfangenen LCD-Frames (`src/render/lcd.ts`) samt der 8 Icon-Segmente
  (`src/render/icons.ts`, Reihe oben/unten), speist den Piezo aus dem gestreamten
  Buzzer-Zustand (`src/emu/audio.ts`) und schickt Tastendrücke zurück.
  Kein Emulator-Tick, kein lokaler Spielstand mehr im Tab.

## Server-Module

| Modul | Verantwortung |
|-------|----------------|
| `server/src/main.ts` | Verdrahtung: Env lesen, Schema anwenden, Tiere rehydrieren, Tick + WS + API + Push-Sweeper starten |
| `server/src/emulator.ts` | `PetEmulator`: WASM laden, `step(ms)` (reale Zeit → CPU-Schritte, **einzige Zeitquelle**), `press(btn)` (Legacy-Tap) / `press(btn, down)` (explizite Flanken, gleichzeitige Kombis), `lcd`, `buzzer` (Piezo-Level für den Live-Ton), `takeToneEvents` (verlustfreier Ton-Ereignisring: jede `set_frequency`/`play_frequency`-Transition mit Emulator-Zeitstempel), `save`/`loadState`, `dead` |
| `server/src/tick.ts` | `TickLoop`: ein Intervall für alle Tiere, Fehler-Isolation pro Tier |
| `server/src/ws.ts` | `WsHub`: `hello`-Auth → Bind an `(userId, petId)`; `{t:"frame", lcd}`/`{t:"frame", lcd, icons}` (bit-gepackt + base64, `icons` nur wenn nicht null), `{t:"buzzer", freq, on}` und `{t:"tones", ev:[{at,freq,play}]}` (verlustfreier Ton-Ereignisstrom) raus, Buttons rein; `sampleBuzzers()` (schneller, zustands-lesender Piezo-Sampler, drainiert auch den Ton-Ring); `hasLiveConnection` als Push-Gate |
| `server/src/api.ts` | REST `/api/*` (Fastify), jeder Aufruf nutzer-scoped über das Bearer-Token |
| `server/src/auth.ts` | Google-ID-Token gegen JWKS prüfen (aus dem früheren Worker übernommen) |
| `server/src/beeps.ts` | `emu_take_buzzer()`-Latch → entprelltes, **generisches** Beep-Ereignis |
| `server/src/push.ts` | Web Push: nur wenn keine Live-Verbindung, `410 Gone` räumt tote Abos |
| `server/src/db/repo.ts` | dünnes Repository über Postgres (kein ORM) |
| `server/src/db/schema.sql` | Tabellen `users`, `pets`, `push_subs`, `save_slots`, `beeps` |

## Client-Module (Browser)

| Modul | Verantwortung |
|-------|----------------|
| `src/net/live.ts` | WS-Client: `hello`/`frame` (lcd+icons, kompakt base64; akzeptiert weiter das Legacy-Array)/`buzzer`/`tones` (verlustfreier Ton-Ereignisstrom)/`state`, `pressDown`+`pressUp` (explizite `{t:"btn"}`-Flanken, gleichzeitige Kombis), Auto-Reconnect mit Backoff |
| `src/net/lcd-codec.ts` | Kompakter Wire-Codec: 512 LCD-Bits → 64 B base64, 8 Icon-Bits → 1 B; von Server (`ws.ts`) und Client (`live.ts`) geteilt |
| `src/emu/audio.ts` | WebAudio-Piezo: `{freq,on}` → Square-Oscillator (der Tab hört das serverseitige Tier) |
| `src/emu/tone-replay.ts` | Spielt den verlustfreien `tones`-Strom mit korrekter Zeit: Emulator-µs-Deltas → Wanduhr-Verzögerungen → Piezo; bricht frühere Pläne bei neuem Batch/Offline ab |
| `src/render/lcd.ts` | 32×16-Frame auf die Canvas zeichnen |
| `src/render/icons.ts` | 8 P1-Icon-Segmente als Reihe oben/unten zeichnen (aus den Frame-Bits) + Guide-Raster |
| `src/emu/input.ts` | A/B/C → logische Buttons → `{t:"btn"}`-Flanken über den Live-Kanal |
| `src/ui/{pets,slots,settings,beeps}.ts` | Tier-Liste, Speicherstände, Einstellungen, Beep-Historie |
| `src/ui/api.ts` | fetch-Plumbing (Bearer-Header, JSON, Fehlerform) |
| `src/ui/boot.ts` | Boot-Overlay: jeder Endzustand blendet den Vorhang aus |
| `src/ui/device.css` | Geräte-Gehäuse (Ei, Zacken-Rahmen, Buttons) — unverändert |
| `src/emu/death.ts` | Engel-Erkennung aus dem LCD-Bild (auch serverseitig genutzt) |
| `src/emu/constants.ts` | geteilte Geometrie/Timing-Konstanten (LCD 32×16, `TS_PER_STEP`) |

## Emulator-Kern (unverändert)

`emu/` baut TamaLIB + HAL-Glue (`src/glue.c`) per `zig cc` nach
`public/emu/tamalib.wasm`. Denselben Build nutzen **Server** (Node) und – nur für
Rendering der empfangenen Frames – der Browser. Kein zweiter Emulator, kein Fork.

## Zeitmodell

`PetEmulator.step(ms)` rechnet eine **reale Dauer** in CPU-Schritte um
(`units = ms·32768/1000`, `steps = units / TS_PER_STEP`, Rest wird übergeben).
Kalibriert ist **~5,65 µs emulierte Zeit pro Schritt** (`TS_PER_STEP = 5.648`).
Der Tick-Loop misst die echte Zeitdifferenz zwischen zwei Ticks und schiebt sie
weiter; dadurch driftet nichts. **Die Zeit kommt jetzt vom Server**, nicht mehr
vom Gerät des Nutzers — Uhr-Manipulation ist damit keine Angriffsfläche mehr.

### Tasten sind Eingabe, keine Zeit

`PetEmulator.press(...)` erzeugt **keine** emulierte Zeit. Die Drücke werden nur
vorgemerkt; die CPU-Schritte, die die gedrückten Pins beobachten, zahlt der
nächste `step(ms)` **aus demselben realen Budget**, das die Uhr schon schuldet.
Ein Druck ändert damit nur *wann* die CPU mit welchem Pin-Zustand läuft, nie
*wie viel* Zeit vergeht: die insgesamt gelaufenen Schritte sind exakt
`floor(Σ units(ms) / TS_PER_STEP)`, unabhängig von der Klickzahl
(`tests/emu-time-exploit.test.ts`, `tests/emu-simultaneous-press.test.ts`).

Zwei Eingabeformen, ein Budget:

- **Legacy-Tap** `press(btn)`: ein in sich geschlossener Klick (Halt
  `PRESS_HOLD_MS = 400 ms` + Release-Lücke `PRESS_GAP_MS = 400 ms`), streng
  sequenziell. Eine schnelle Sequenz (z. B. Uhrstellen) erreicht das ROM so als
  getrennte Flanken und staut sich in Echtzeit-Tempo ab.
- **Explizite Flanken** `press(btn, true/false)`: Der Client sendet beide
  Flanken (`{t:"btn", btn, down}`); der Server hält eine **Menge** gedrückter
  Pins und lässt so **jede Kombination gleichzeitig** LOW werden. Das P1-ROM
  tastet die Matrix pro Frame ab, und sein **Ton-Schalter ist A+C zusammen**
  (SELECT+NEXT) — nur so kommt die Kombi beim ROM an. Der Release wartet, bis
  die `PRESS_HOLD_MS`-Mindesthaltung bezahlt ist, damit auch ein schneller Tipp
  als eigene Flanke landet.

Die 400 ms Halt sind ROM-Anforderung (kürzer registriert das P1-ROM keinen
Uhrstellen-Tap und keine A+C-Kombi), nicht Zeitquelle. Siehe
[docs/SIMULTANEOUS-PRESS.md](./SIMULTANEOUS-PRESS.md).

## Catch-up nach Downtime

`pets.last_tick_at` hält fest, wann ein Tier zuletzt getickt wurde. Beim Boot (und
beim Rehydrieren) holt der Server die verstrichene reale Zeit in **60-s-Scheiben**
nach (`stepInSlices`), damit ein langer Ausfall kein ein riesiger synchroner
Rechenblock wird. Ein Neustart verliert kein Tier, holt nur Zeit auf.

## Persistenz

`pets.state` ist ein Bytea-Snapshot des WASM-Linearspeichers (CPU-, RAM-, LCD-Zustand),
transportiert als Hex (`decode($n,'hex')`/`encode(col,'hex')`), damit beliebige Bytes
byte-exakt überleben. Geschrieben wird gedrosselt (bei nennenswerter Änderung, max.
alle 60 s) und beim Tod. `state_ver` ist die Format-Version.

## Tod

Ausschließlich aus dem **LCD-Bild** erkannt: Engel-Figur mit Sternen
(`src/emu/death.ts`, zentraler Figuren-Bereich `BOX`, Toleranz 6). Kein CPU-Signal;
`hal->halt()` ist in TamaLIB unbrauchbar (wird nie aufgerufen). Der Server setzt
`alive=false` und `died_at` — einen **Grund** gibt es nicht.

Weiter: [DECISIONS.md](./DECISIONS.md) · [GAMEPLAY.md](./GAMEPLAY.md) ·
[AUTH-SYNC.md](./AUTH-SYNC.md) · [BEEPS.md](./BEEPS.md) ·
[README.md](./README.md)
