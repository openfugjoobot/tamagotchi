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
