# Entscheidungen

Chronologisch, neueste zuerst. Jede Entscheidung nennt den Grund — damit sie
später nicht versehentlich zurückgedreht wird.

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

**Live-Ansicht (2026-10-17):** Das Gerät zeichnet die 8 Icons wieder. Das
Task-6-Protokoll wurde um die Icon-Segmente erweitert:
`{t:"frame", lcd, icons}` — `icons` ist ein Array aus 8 Bits (0/1), die aus
`emu_icons()` (HAL `h_set_lcd_icon`) stammen. Der Client zeichnet daraus die
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
