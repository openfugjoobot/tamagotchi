# Entscheidungen

Chronologisch, neueste zuerst. Jede Entscheidung nennt den Grund — damit sie
später nicht versehentlich zurückgedreht wird.

## Frame-Transport kompakt: bit-gepackt statt 512-Zahlen-Array (2026-10-17)

- **Problem:** Der Frame trug den 32×16-LCD als JSON-Array aus 512 `0`/`1`
  (`{t:"frame", lcd:[0,1,…]}`) — ~1 KB Text für 512 Bit Nutzdaten, und der
  Client parste 512 Zahlen. Zusätzlich trug **jeder** Frame die 8 Icon-Bits
  (8-Zahlen-Array), obwohl das ausgelieferte P1-ROM die Segmente nie treibt —
  also konstant `[0,…]`, 100 % totes Gewicht.
- **Fix (LCD):** Der Frame-`lcd` ist jetzt **bit-gepackt + base64**: 512 Bit →
  64 Bytes → 88 Zeichen. Bit-Order LSB-first im Byte, Index `i = y*32+x` →
  Byte `i>>3`, Bit `i&7`. Beide Seiten nutzen **denselben** Codec
  (`src/net/lcd-codec.ts`, importiert von `server/src/ws.ts` **und**
  `src/net/live.ts`), damit Pack/Unpack nicht auseinanderlaufen.
- **Fix (Icons):** Die 8 Segment-Bits werden zu **einem** Byte gepackt, und das
  `icons`-Feld wird **weggelassen, solange alle 8 Bits 0 sind** (der
  Normalfall). Es erscheint nur auf Frames, die wirklich ein Segment anzünden.
  Der Change-Detector vergleicht weiter LCD **und** Icons plus „war `icons` auf
  der Leitung?", damit ein reiner Icon-Wechsel (0 → 1) ein Frame auslöst und ein
  später auf 0 zurückfallender Stand das Feld wieder weglässt.
- **Back-Compat:** Der Client akzeptiert weiterhin das alte 512-Zahlen-`lcd`
  und das 8-Zahlen-`icons` (Fallback in `readLcd`/`readIcons`), damit ein
  Client gegen einen Server läuft, der den Codec noch nicht hat.
- **Verifikation:** `tests/lcd-codec.test.ts` (Round-Trip Bit für Bit, jede
  Einzelbit-Position, Truncation, ungültige base64), `tests/live-client.test.ts`
  (kompakte base64 dekodieren, Legacy-Array, fehlendes `icons` → dezente Reihe),
  `tests/server-ws.test.ts` (base64-`lcd`, `icons` fehlt bei 0-Bits, Icon-Wechsel
  löst aus). Volle Suite grün.

## Gleichzeitige Tastenkombis (SELECT+NEXT = A+C) erreichen das ROM (2026-10-17)

- **Fehler:** Die Server-Ownership (s. unten) reduzierte Tasten auf **diskrete**
  `{t:"press"}`-Taps, und `PetEmulator.press()` materialisierte **einen** Button
  nach dem anderen. Zwei Pins waren damit **nie im selben gesampelten Frame** LOW.
  Das P1-ROM tastet die Matrix aber pro Frame ab, und sein **Ton-Schalter ist A+C
  zusammen** (SELECT+NEXT); ebenso brauchen Uhrstell-/Menü-Kombis zwei Buttons
  gleichzeitig. A-then-C ist nicht A+C.
- **Beweis am echten ROM:** Nach dem Uhrstellen A+C zusammen → Piezo-Mute
  (`emu_en()` fällt über ein Vernachlässigungsfenster auf ~0), A-dann-C → Tier
  piepst weiter. Tabelle in [docs/SIMULTANEOUS-PRESS.md](./SIMULTANEOUS-PRESS.md).
- **Fix:** Das Protokoll trägt jetzt die **Flanke** (`{t:"btn", btn, down}`); der
  Client sendet down *und* up. Der Server hält eine **Menge** gedrückter Pins und
  lässt so beliebige Kombis gleichzeitig LOW werden. Ein Release wartet auf die
  `PRESS_HOLD_MS`-Mindesthaltung, damit auch ein schneller Tipp eine eigene
  Flanke bleibt.
- **Zeit-Invariante bleibt:** Der Hold-Pfad zahlt die CPU-Schritte aus demselben
  realen Budget wie der Tap-Pfad; `steps()` ist weiter exakt
  `floor(Σ units(ms) / TS_PER_STEP)`, unabhängig von den gehaltenen Buttons
  (`tests/emu-simultaneous-press.test.ts`). Die gleichzeitige Eingabe ändert nur
  *welche Pins* LOW sind und *wann*, nie *wie viel* Zeit vergeht.
- **Back-Compat:** `{t:"press"}` (Legacy-Tap) und `press(btn)` bleiben bestehen;
  ein Alt-Stub ohne zweiten Parameter ignoriert ihn einfach.

## Tasten sind Eingabe, nicht Zeit — Zeit-Exploit geschlossen (2026-10-17)

- **Fehler:** `PetEmulator.press()` fuhr pro Druck **800 ms emulierte Zeit**
  (400 ms down + 400 ms up). Damit war der Tastendruck eine *zweite* Uhr neben
  dem Tick-Loop: wer A/B/C schnell genug drückte, trieb das Spiel schneller als
  die Echtzeit — ein Tier ließ sich in Sekunden altern und töten. Genau das
  sollte die Server-Ownership der Zeit (s. oben) verhindern; ein Rest des alten
  Tab-Emulators hatte es wieder eingeschleppt.
- **Fix:** `press()` erzeugt **keine** Zeit mehr, sondern legt den Druck nur in
  eine Warteschlange. Der nächste `step(ms)` (die reale Echtzeit des Tick-Loops)
  materialisiert den Druck als kurzen down→up-Zyklus — der gedrückte Pin wird
  also *aus dem schon geschuldeten Realzeit-Budget bezahlt*. Die insgesamt
  gelaufenen CPU-Schritte bleiben exakt `floor(Σ units(ms) / TS_PER_STEP)`, egal
  wie oft geklickt wurde.
- **Drücke werden nicht zusammengefasst.** Der Ursprungscode fuhr jeden Druck
  vollständig; ein Coalescing hätte die schnelle Uhrstell-Sequenz zerstört
  (mehrere Taps in einem Tick ⇒ nur ein Klick). Stattdessen Queue in
  Ankunftsreihenfolge, mit 400 ms Release-Lücke zwischen zwei Drücken für
  getrennte Flanken.
- **400 ms Halt ist ROM-Anforderung, keine Zeitquelle.** Gegen die echte P1-FW
  verifiziert: eine 100-ms-Halt registriert den Uhrstellen-Tap nie, 400 ms schon
  (`tests/server-emulator-buzzer.test.ts`). Die Halt-Dauer bleibt also, nur ihre
  *Herkunft* ändert sich: früher gemünzt, jetzt aus Echtzeit bezahlt.
- **Beweis:** `tests/emu-time-exploit.test.ts` — 200 Klicks über dieselbe reale
  Spanne liefern denselben Schrittzähler wie 0 Klicks; ein Druck allein bewegt
  die Uhr nicht; nur `step(ms)` tut es.
- **Ehrlicher Zähler:** `PetEmulator.steps()` zählt die gelaufenen CPU-Schritte;
  das ist das belastbare Maß für „gewährte Spielzeit“ (`now()` hängt zusätzlich
  vom ROM-Codepfad ab, der sich mit dem Tastenzustand ändert).

## Server statt Cloudflare Worker (2026-10-17)

- **Der Worker wurde verworfen.** Ein Cloudflare-Isolate kann **nicht dauerhaft
  pro Nutzer ticken** — es lebt nur, solange eine Anfrage es wachhält. Ein Tier,
  das auch bei geschlossenem Browser weiterläuft, braucht einen **always-on**
  Prozess.
- **Eigener Dienst** auf dem fugjoo-Host: Node/TypeScript (`fastify` + `ws`),
  Container `tamagotchi-server` im `proxy`-Netz, erreichbar über Nginx Proxy
  Manager. `tamagotchi.fugjoo.com` bleibt die App; der Server liegt hinter
  demselben Host unter `/api/*` **und** `/ws` (kein CORS, keine neue
  Zertifikatsfrage, same-origin).
- Der frühere statische Container (nginx) wird zum reinen Frontend-Host.
- Die Google-JWKS-Prüfung wanderte **unverändert** aus `src/worker/auth.ts` in
  `server/src/auth.ts`. `worker/`, `wrangler.toml` und der `/api/save`-KV-Pfad
  wurden entfernt.

## Der Server besitzt die Zeit (2026-10-17)

- Früher tickte der Emulator im Browser; Manipulation der Geräteuhr und
  Tab-Throttling beeinflussten die Echtzeit (das war „nicht abwehrbar").
- Jetzt treibt **ein** Tick-Loop auf dem Server alle Tiere mit der realen
  Zeitdifferenz. `?speed=`, lokaler Spielstand und Catch-up im Tab entfallen.
- Vorteile: gleiches Tempo für alle, deterministisch, und ein Serverneustart holt
  die verstrichene Zeit über `last_tick_at` in 60-s-Scheiben nach.
- Kosten: ohne Server läuft nichts. Bewusst akzeptiert (Betriebsentscheidung oben).

## Beeps sind generisch (2026-10-17)

- Der Piezo liefert ein **Beep-Signal** (`emu_take_buzzer()`, Latch), aber
  **keinen Grund**. Ob Hunger, Krankheit oder Aufmerksamkeit: aus dem ROM nicht
  belastbar auslesbar (`docs/BEEPS.md`, Anhang A4 des Specs).
- Deshalb wird nur *dass* es piepte gespeichert — `beeps` hat **kein `kind`** — und
  die Benachrichtigung ist grundlos („Dein Tamagotchi braucht dich").
- Eine abgeleitete Ursache wäre **geraten**; geratene Ursachen kommen nicht in die
  Daten oder in den Text.
- Der Latch wird über ein **60-s-Fenster pro Tier** entprellt (gemessen: echte
  Aufmerksamkeits-Schübe liegen ≥ 114 s auseinander, also kollabiert das Fenster
  einen Schub zu einem Ereignis, ohne zwei zu verschlucken).

## Ton im Tab kommt vom Server (2026-10-17)

- Der Tab führt keinen Emulator mehr, trotzdem soll er **klingen**. Der Server
  schickt daher den **Piezo-Zustand** des Tiers über den Live-Kanal:
  `{t:"buzzer", freq, on}` (`PetEmulator.buzzer()` = `emu_freq()`/`emu_en()`,
  ein *Level*, nicht der konsumierte Latch).
- Gesendet wird **nur bei Änderung** (der Hub diffed gegen den letzten Wert),
  genau wie beim LCD-Frame — ein stilles Tier kostet kein Byte.
- Die Werte gehen **unskaliert** durch; die Umrechnung in Hz macht der Client
  (`src/emu/audio.ts`), wie schon im früheren Tab-Emulator. Das hält
  Server und Client byte-identisch zu dem, was vor der Server-Ownership klang.
- Ein Tier ohne `buzzer()` (Alt-Stub) degradiert zu „immer still": es wird nie
  eine Buzzer-Nachricht gestreamt, Frame/State laufen unberührt weiter.

## Piezo wird feiner abgetastet als der LCD-Tick (2026-10-17)

- Der LCD-Tick läuft mit **125 ms (8 fps)**. Das ist für den Piezo **zu grob**:
  eine gemessene Chirp-Burst ist bis zu **50 ms** kurz (Durchschnitt 136 ms,
  `docs/BEEPS.md`). Am echten ROM gemessen (36 Bursts in ~200 s): der 125-ms-
  Sampler erkennt **27/36 (75 %)**, mittlere Latenz **57 ms**, Maximum **125 ms**
  — ein Viertel der Chirps geht verloren, der Rest kommt bis zu einen Tick zu spät.
- Deshalb gibt es einen **eigenen, schnellen Buzzer-Sampler** (`BUZZER_SAMPLE_MS`,
  Default **20 ms**) neben dem Tick: er liest je gebundenem Socket den Pegel und
  streamt `{t:"buzzer"}` bei Änderung. Bei 20 ms landen **36/36** Bursts, mittlere
  Latenz **~12 ms**.
- **Zustands-Lesen, kein Zeitschritt:** der Sampler liest `buzzer()` (ein *Level*)
  und ruft **nie** `pet.step()` — er schenkt **keine** emulierte Zeit. Die
  Zeit-Invariante (Tastendruck münzt keine Spielzeit, die Uhr folgt nur der
  Wanduhr) bleibt unberührt. Der Tick ruft den Sampler ebenfalls auf; die
  Level-Diff im Hub macht die Überlappung idempotent.
- **Der Client re-artikuliert gleiche Töne:** der Server schickt nur den Pegel,
  zwei gleiche Chirps kommen als on→off→on. `src/emu/audio.ts` startet die
  Wellenform bei einem **frischen On-Edge** neu (Oszillator stop+start, Phase 0),
  statt die Verstärkung nur erneut anzuheben — sonst verschmölzen zwei gleich
  hohe Chirps zu einem durchgehenden Ton. `state().articulations` zählt die
  Toneinsätze (Diagnose/Tests).

## Tod wird am Bild erkannt (2026-10-17)

- **Kein CPU-Signal.** TamaLIB ruft `hal->halt()` nie auf; das Halted-Flag des
  Kerns blieb über 8+ simulierte Tage konstant 0.
- **Nur das LCD-Bild.** Im Todesfall zeichnet das P1-ROM einen Engel mit Sternen.
  Die Figur ist stabil, nur die Sternchen animieren — ein ganzer Frame-Hash
  scheitert daran, ein **Formvergleich des zentralen Bereichs** funktioniert
  (`src/emu/death.ts`, `BOX` + `TOLERANCE`).
- Auch hier gibt es **keinen Grund**: `pets` hat kein `cause_of_death`, `died_at`
  ist die einzige Todes-Information. Der Client zeigt nie eine Ursache.

## Emulation statt Nachbau (2026-10-11, gilt weiter)

Der erste Versuch (eigene Engine + handgezeichnete Sprites) wirkte nicht
originalgetreu. Abgelöst durch **Ausführen der echten Firmware** (TamaLIB, GPLv2;
ROM `tama.bin` aus dem MAME-Romset `tama.zip`, MD5 `3fce172403c27274e59723bbb9f6d8e9`).
Logik, Menü, Icons, Animation und Timing sind damit 1:1 das Original.

## Build ohne Emscripten/Docker/root (2026-10-11, gilt weiter)

Statt Emscripten wurde **Zig** (`zig cc`, `wasm32-freestanding`) gewählt: ein
einzelnes ~45-MB-Binary, kein root, kein 1,5-GB-Image. `emu/build.sh` ist
reproduzierbar.

## Storage- und Theme-Entscheidungen (2026-10-11, weiterhin gültig)

- **localStorage-Keys zentral** in `src/storage/keys.ts` (früher überschrieben sich
  alle Einstellungen als Literal `"***"`).
- **Kein Auto-Reload bei SW-Updates** (network-first SW; ein Reload erzeugte einen
  zweiten Spinner).
- **Offline ab dem ersten Besuch** über `dist/precache.json`.
- **Theme ohne Flash**: `public/theme-init.js` setzt `body[data-bg]` vor dem Paint.
- **Hintergrund „Auto"**: folgt der Tageszeit (`blossom`/`day`/`dusk`/`night`/
  `midnight`), 60-s-Intervall wendet nur bei Wechsel neu an.

## Lizenz & Rechtliches (gilt weiter)

- TamaLIB ist **GPLv2** → dieses Projekt ebenfalls GPLv2.
- ROM/Firmware nur für **privaten Gebrauch**, nicht im Repo, keine Distribution.

## Icons (2026-10-11, aktualisiert 2026-10-17)

Die 8 P1-Menü-Icons sind feste LCD-Segmente, keine Bitmap im ROM (`icons()` bleibt
leer). Die Grafiken stammen aus `GMMan/flipperzero-tamagotch-p1` (Lizenz dort unklar,
privater Gebrauch).

**Live-Ansicht (2026-10-17, Transport kompakt seit 2026-10-17):** Das Gerät
zeichnet die 8 Icons. Das Task-6-Protokoll trägt sie als **optionales**
`icons`-Feld: `{t:"frame", lcd:<base64>, icons?:<base64>}` — `lcd` ist der
bit-gepackte LCD (s. o.), `icons` ein einzelnes base64-Byte mit den 8 aus
`emu_icons()` (HAL `h_set_lcd_icon`) stammenden Bits. Das Feld wird
**weggelassen, solange alle Bits 0 sind** (der Normalfall beim ausgelieferten
ROM), sodass eine dezente Reihe nichts kostet. Der Client zeichnet daraus die
Reihen oben/unten (`src/render/icons.ts`, `drawIconRow`); aktive Segmente voll,
inaktive dezent. Der Change-Detector des Hubs vergleicht **LCD und Icons**, damit
auch ein reiner Icon-Wechsel ein Frame ausloest.

Wichtig: Beim ausgelieferten P1-ROM treibt das ROM die Segment-Referenzen
(seg 8/28 in `hw.c`) **nicht** — verifiziert per Live-Probe ueber die echte
WASM/ROM-Kette: alle 8 Bits bleiben 0. Die Reihe ist daher faktisch durchgehend
dezent. Sie fasst aber **keinen** hartkodierten leeren Puffer mehr an: die Bits
sind echt uebertragen und leuchten auf, sobald ein ROM/Gerät die Segmente
treibt — ohne weitere Protokollaenderung. Eine frühere Runde (Fix B1) hatte die
Reihe ganz entfernt, weil sie einen nie wechselnden Zustand aus einem
hartkodierten Null-Puffer zeigte; jetzt ist die Quelle des Zustands echt, daher
ist die Reihe wieder da. Die statischen Grafiken auf der Guide-Seite
(`renderIconGrid`) bleiben.
