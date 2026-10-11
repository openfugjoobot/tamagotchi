# Entscheidungen

## Ansatz: Emulation statt Nachbau

Der erste Versuch (eigene Engine + handgezeichnete Sprites) wirkte nicht
originalgetreu. Abgelöst durch **Ausführen der echten Firmware**:

- **TamaLIB** (`jcrona/tamalib`, GPLv2) — hardware-agnostische P1-Emulation
  (Epson E0C6S46 @ 32768 Hz, LCD 32×16 B/W, 8 Icons).
- **ROM**: `tama.bin` aus dem MAME-Romset `tama.zip`
  (MD5 `3fce172403c27274e59723bbb9f6d8e9`, 12288 Bytes).
- Ergebnis: Logik, Menü, Icons, Animation und Timing sind 1:1 das Original.

## Build ohne Emscripten/Docker/root

Statt Emscripten wurde **Zig** (`zig cc`, `wasm32-freestanding`) gewählt: ein
einzelnes ~45-MB-Binary, kein root, kein 1,5-GB-Image — passt auch auf eine
volle Platte. `emu/build.sh` ist reproduzierbar.

## Timing

Schrittbasiert kalibriert (~5,65 µs/Schritt). Kein `sleep` im HAL, damit das
Timing im Browser deterministisch und speed-skalierbar bleibt.

## Lizenz & Rechtliches

- TamaLIB ist **GPLv2**. Für privaten Gebrauch unkritisch; eine Veröffentlichung
  müsste die Lizenzpflichten erfüllen.
- ROM und Firmware nur für **privaten Gebrauch**, keine öffentliche Distribution.

## Nicht abwehrbar

Geräteuhr-Manipulation und Browser-Throttling bei inaktivem Tab beeinflussen die
Echtzeit; der Frame-Loop klemmt große Deltas, um Sprünge zu begrenzen.

## Icons

Die 8 Menü-Icons sind beim P1 **feste LCD-Segmente** und nicht als Bitmap im ROM —
der Emulator liefert dafür also keine Grafik (`icons()` bleibt leer; die ROM zeichnet
ihr aktives Menü-Icon selbst im 32×16-Raster). Für die sichtbare Icon-Leiste werden
die echten P1-Icon-Grafiken aus dem Open-Source-Projekt
`GMMan/flipperzero-tamagotch-p1` (`icons/icon_0..7.png`) verwendet; der weiße
Hintergrund wird zur Laufzeit per Luminanz weggekeyt. Lizenz dort nicht eindeutig
ausgewiesen — für privaten Gebrauch unkritisch. Aktive Icons voll, inaktive dezent.

## Storage & Updates (2026-10-11)

- **localStorage-Keys zentral** in `src/storage/keys.ts`. Vorher waren
  `LANG_KEY`/`SOUND_KEY`/`SHELL_KEY`/`BG_KEY` alle das Literal `"***"` und
  überschrieben sich gegenseitig; seither überlebt jede Einstellung einen Reload.
- **Kein Auto-Reload bei SW-Updates**: der `controllerchange`-Reload erzeugte
  beim SW-Wechsel einen zweiten Lade-Spinner. Der SW ist network-first, Inhalte
  sind also ohnehin frisch.
- **Offline ab dem ersten Besuch**: `dist/precache.json` (Build-Artefakt,
  `scripts/gen-precache.mjs`) listet alle Assets; der SW cached sie im `install`.
- **Theme ohne Flash**: `public/theme-init.js` (klassisches Script direkt nach
  `<body>`) setzt `body[data-bg]` vor dem ersten Paint; die Guide-Seite folgt so
  demselben Theme wie die Startseite.

## Hintergrund "Auto" (2026-10-11)

- `forest` ist raus; an letzter Stelle der Swatches steht **Auto**. Es speichert die
  Auswahl `auto` und zeigt das zur Uhrzeit passende Theme:
  `05–09 blossom` (Morgen), `09–17 day`, `17–20 dusk`, `20–23 night`, sonst `midnight`.
- Auflösung in `src/theme.ts` (`phaseForHour`/`resolveTheme`) und – für den
  flackerfreien Start – dupliziert in `public/theme-init.js`.
- Bei `auto` prüft ein 60-s-Intervall, ob die Tageszeit ein anderes Theme verlangt
  (nur dann wird neu angewendet, damit das Gras nicht ständig neu aufgebaut wird).
