# Architektur

Die App ist eine **Full-Stack-Plattform**: das Tamagotchi läuft **auf dem Server**,
der Browser ist nur Fenster und Fernbedienung. Die Emulation ist weiterhin die
**echte Firmware** in TamaLIB (WASM) — es wird nichts nachgebaut.

```
Browser                                  tamagotchi-server (Node)          Postgres
  src/net/live.ts  ──WS /ws────────────▶  server/src/ws.ts                 (pets.state)
   render/lcd.ts   ◀─{t:"frame"}          server/src/emulator.ts (WASM)
   emu/input.ts    ──{t:"press"}          server/src/tick.ts (ein Loop, 125 ms)
   ui/*.ts         ──REST /api/*────────▶ server/src/api.ts (Fastify)
                                           server/src/beeps.ts (Debounce)
                                           server/src/push.ts (web-push) ──▶ Push-Service
```

## Rollen

- **Server = Spiel.** Jedes Tier hat eine eigene `PetEmulator`-Instanz mit eigenem
  WASM-Speicher. Der Server kennt die Zeit und treibt alle Tiere in **einem**
  Tick-Loop (`server/src/tick.ts`, 125 ms ≈ 8 fps). Läuft weiter, auch wenn kein
  Browser offen ist.
- **Browser = Client.** `src/net/live.ts` verbindet sich per WebSocket, zeichnet die
  empfangenen LCD-Frames (`src/render/lcd.ts`) und schickt Tastendrücke zurück.
  Kein Emulator-Tick, kein lokaler Spielstand mehr im Tab.

## Server-Module

| Modul | Verantwortung |
|-------|----------------|
| `server/src/main.ts` | Verdrahtung: Env lesen, Schema anwenden, Tiere rehydrieren, Tick + WS + API + Push-Sweeper starten |
| `server/src/emulator.ts` | `PetEmulator`: WASM laden, `step(ms)` (reale Zeit → CPU-Schritte), `press`, `lcd`, `save`/`loadState`, `dead` |
| `server/src/tick.ts` | `TickLoop`: ein Intervall für alle Tiere, Fehler-Isolation pro Tier |
| `server/src/ws.ts` | `WsHub`: `hello`-Auth → Bind an `(userId, petId)`; Frames raus, Buttons rein; `hasLiveConnection` als Push-Gate |
| `server/src/api.ts` | REST `/api/*` (Fastify), jeder Aufruf nutzer-scoped über das Bearer-Token |
| `server/src/auth.ts` | Google-ID-Token gegen JWKS prüfen (aus dem früheren Worker übernommen) |
| `server/src/beeps.ts` | `emu_take_buzzer()`-Latch → entprelltes, **generisches** Beep-Ereignis |
| `server/src/push.ts` | Web Push: nur wenn keine Live-Verbindung, `410 Gone` räumt tote Abos |
| `server/src/db/repo.ts` | dünnes Repository über Postgres (kein ORM) |
| `server/src/db/schema.sql` | Tabellen `users`, `pets`, `push_subs`, `save_slots`, `beeps` |

## Client-Module (Browser)

| Modul | Verantwortung |
|-------|----------------|
| `src/net/live.ts` | WS-Client: `hello`/`frame`/`state`/`press`, Auto-Reconnect mit Backoff |
| `src/render/lcd.ts` | 32×16-Frame auf die Canvas zeichnen |
| `src/emu/input.ts` | A/B/C → `{t:"press"}` über den Live-Kanal |
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
