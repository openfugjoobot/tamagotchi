# Tamagotchi P1 (Emulator)

Originalgetreue P1-Emulation im Browser: Die **echte Firmware** läuft in einer
WASM-Emulation (TamaLIB) — Logik, Menü, Icons, Animation und Timing sind damit
1:1 das Original. Geräte-Optik, Buttons, Sound und PWA drumherum. Nur privater Gebrauch.

## Start

```bash
npm install
npm run dev      # Dev-Server
npm run build    # Produktions-Build (dist/)
npm run test     # Vitest
```

Emulator-Build (nur nötig, wenn `emu/` geändert wird):

```bash
ZIG=/pfad/zu/zig bash emu/build.sh   # → public/emu/tamalib.wasm
```

## Bedienung

- **A / B / C** = linke / mittlere / rechte Taste (Klick, Touch oder Tastatur:
  `A`/`←`, `Enter`/`Space`, `Esc`/`→`).
- **`?speed=N`** — Emulation N× schneller (z. B. `?speed=600`).
- **`?shell=pink`** — pinkes Gehäuse (Default blau).

## Aufbau

```
emu/        C→WASM-Build (TamaLIB + HAL-Glue, Zig) + ROM
public/emu/ tamalib.wasm, rom0.bin (Artefakte)
src/emu/    TS-Wrapper, Input-Map, Piezo-Audio
src/render/ LCD-Canvas
src/storage/ Emulator-Snapshot in localStorage
src/ui/     Geräte-Gehäuse
src/main.ts Verdrahtung (Frame-Loop, Buttons, Sound, Save)
```

Weiter: [ARCHITECTURE.md](./ARCHITECTURE.md) · [DECISIONS.md](./DECISIONS.md)
