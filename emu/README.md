# Emulator-Build (TamaLIB → WASM)

Dieser Ordner baut die Emulations-Bibliothek **TamaLIB** (`jcrona/tamalib`, GPLv2)
zusammen mit einer kleinen HAL-Glue (`src/glue.c`) nach `public/emu/tamalib.wasm`.

- **Compiler:** [Zig](https://ziglang.org/) (`zig cc`, Target `wasm32-freestanding`).
  Kein Emscripten, kein Docker, kein root nötig.
- **Aufruf:** `ZIG=/pfad/zu/zig bash emu/build.sh`

## ROM

- `public/emu/rom0.bin` ist die P1-Firmware (`tama.bin`, 12288 Bytes), entnommen aus
  dem MAME-Romset `tama.zip` (`tama.bin`, CRC/MD5 `3fce172403c27274e59723bbb9f6d8e9`).
- Nur für **privaten Gebrauch**; nicht öffentlich distributieren.

## Lizenz

TamaLIB steht unter **GPLv2** (siehe `vendor/tamalib/LICENSE`). Bei einer
Veröffentlichung müssten die Lizenzpflichten erfüllt werden.
