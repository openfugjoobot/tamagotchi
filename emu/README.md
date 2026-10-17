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

### Provisioning (Clean Clone / Docker-Build)

Ein frischer Clone enthält **keine** ROMs, und `tamalib.wasm` wird ebenfalls erst
gebaut. Der Server kann damit weder lokal noch im Container booten. Reihenfolge:

1. **WASM bauen:** `ZIG=/pfad/zu/zig bash emu/build.sh` → `public/emu/tamalib.wasm`.
   (`tamalib.wasm` ist eingecheckt; nur neu bauen, wenn sich die Glue/TamaLIB ändert.)
2. **ROMs bereitstellen** — Dateien exakt so benennen und nach `public/emu/` legen:
   - `rom0.bin` (P1, 12288 Bytes, MD5 `3fce172403c27274e59723bbb9f6d8e9`),
   - `rom2.bin` (P2, 12288 Bytes, MD5 `42932a81ed40be09e27c8aa1670495fc`).
   Bezug: MAME-Romset `tama.zip` (P1) bzw. der oben beschriebene Community-Dump (P2).
3. **Integrität prüfen:** `md5sum public/emu/rom0.bin public/emu/rom2.bin` muss die
   obigen Hashes liefern — falsche/fehlende Dateien lassen den Server sofort abbrechen.
4. **Docker:** der Build-Kontext muss `public/emu/` enthalten; der `Dockerfile` kopiert
   die Dateien ins Image. Auf CI/Host also Schritt 1+2 vor `docker build` ausführen.

Fehlt eine der drei Dateien in `public/emu/`, beendet sich der Server beim Start mit
`missing emulator asset: <pfad>` (statt eines kryptischen ENOENT), siehe `server/src/main.ts`.

## Lizenz

TamaLIB steht unter **GPLv2** (siehe `vendor/tamalib/LICENSE`). Bei einer
Veröffentlichung müssten die Lizenzpflichten erfüllt werden.
