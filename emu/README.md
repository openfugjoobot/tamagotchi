# Emulator-Build (TamaLIB → WASM)

Dieser Ordner baut die Emulations-Bibliothek **TamaLIB** (`jcrona/tamalib`, GPLv2)
zusammen mit einer kleinen HAL-Glue (`src/glue.c`) nach `public/emu/tamalib.wasm`.

- **Compiler:** [Zig](https://ziglang.org/) (`zig cc`, Target `wasm32-freestanding`).
  Kein Emscripten, kein Docker, kein root nötig.
- **Aufruf:** `ZIG=/pfad/zu/zig bash emu/build.sh`

## ROM

- `public/emu/rom0.bin` — P1-Firmware (`tama.bin`, 12288 Bytes), MAME-Romset `tama.zip`,
  MD5 `3fce172403c27274e59723bbb9f6d8e9`.
- `public/emu/rom2.bin` — P2-Firmware, 12288 Bytes, MD5
  `42932a81ed40be09e27c8aa1670495fc`. Quelle: ein von Chip-Die-Fotos abgelesenes
  `u12_t`-Dump der Community (japanische Ausgabe), umgerechnet nach Byte-ROM:
  `rom[i*2] = (v >> 8) & 0xFF`, `rom[i*2+1] = v & 0xFF` (6144 Wörter, big-endian).
  Ein internationales P2-ROM ist bisher nicht öffentlich verfügbar.

Beide Dateien sind Bandai-Copyright und **nicht** im Repo (`.gitignore`). Nur für
**privaten Gebrauch**; nicht öffentlich distributieren.

## Lizenz

TamaLIB steht unter **GPLv2** (siehe `vendor/tamalib/LICENSE`). Bei einer
Veröffentlichung müssten die Lizenzpflichten erfüllt werden.
