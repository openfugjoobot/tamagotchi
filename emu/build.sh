#!/usr/bin/env bash
# Baut TamaLIB + HAL-Glue nach WASM. Braucht Zig (kein Emscripten/Docker/root).
#   ZIG=/pfad/zu/zig bash emu/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."   # Projektwurzel

ZIG="${ZIG:-/tmp/zig-linux-aarch64-0.13.0/zig}"
if [ ! -x "$ZIG" ]; then
  echo "Zig nicht gefunden: $ZIG (setze ZIG=...)" >&2
  exit 1
fi

EXPORTS=(
  -Wl,--export=emu_rom_byte
  -Wl,--export=emu_init
  -Wl,--export=emu_step
  -Wl,--export=emu_advance
  -Wl,--export=emu_set_button
  -Wl,--export=emu_lcd
  -Wl,--export=emu_icons
  -Wl,--export=emu_freq
  -Wl,--export=emu_en
  -Wl,--export=emu_take_buzzer
  -Wl,--export=emu_now
  -Wl,--export-memory
)

mkdir -p public/emu
"$ZIG" cc -target wasm32-freestanding -O2 -nostdlib \
  -Wl,--no-entry "${EXPORTS[@]}" \
  -Iemu/vendor -Iemu/vendor/tamalib \
  -o public/emu/tamalib.wasm \
  emu/vendor/tamalib/cpu.c emu/vendor/tamalib/hw.c emu/vendor/tamalib/tamalib.c emu/src/glue.c

echo "built public/emu/tamalib.wasm ($(stat -c%s public/emu/tamalib.wasm) bytes)"
