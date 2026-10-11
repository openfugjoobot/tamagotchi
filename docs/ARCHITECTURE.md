# Architektur

Die App **emuliert** das Original, statt es nachzubauen.

```
emu/ (Build-Zeit)                    Browser (Laufzeit)
  vendor/tamalib  ──┐                  main.ts
  src/glue.c        │  zig cc          │  requestAnimationFrame
                    ▼                   ▼
             public/emu/tamalib.wasm  emu/emulator.ts ──step(n)──> WASM
             public/emu/rom0.bin      │  lcd()                     │
                                      ▼                            ▼
                                render/lcd.ts ──> Canvas 2D   (32×16 B/W)
                                      ▲
             Buttons A/B/C ──> emu/input.ts ──> emulator.setButton()
             Piezo ──> emu/audio.ts (WebAudio)
             Save ──> storage/persist.ts (Snapshot)
```

## Module

| Modul | Verantwortung |
|-------|----------------|
| `emu/vendor/tamalib` | TamaLIB: E0C6S46-CPU + Peripherie (GPLv2; das Spiel steckt im ROM) |
| `emu/src/glue.c` | HAL-Implementierung + WASM-Exporte (LCD-, Icon-, Button-, Piezo-Puffer) |
| `emu/build.sh` | Zig-Build nach `public/emu/tamalib.wasm` |
| `src/emu/emulator.ts` | WASM laden, ROM laden, `step`, Buttons, LCD-Puffer, Save/Load |
| `src/emu/input.ts` | A/B/C → left/middle/right; Tastatur-Mapping |
| `src/emu/audio.ts` | Piezo-Frequenz → Square-Oszillator |
| `src/render/lcd.ts` | 32×16-Puffer integer-skaliert auf Canvas |
| `src/storage/persist.ts` | Snapshot des emulierten Zustands |
| `src/main.ts` | Frame-Loop: `step(n)` → LCD → Canvas, Buttons, Sound, Autosave |
| `src/ui/device.css` | Geräte-Gehäuse (Ei, Zacken-Rahmen, Buttons, Chain) |

## Zeitmodell

`tamalib_step()` führt jeweils einen CPU-Schritt aus; der HAL treibt die Zeit über
`sleep_until`/`get_timestamp` (schrittbasiert, kein `sleep`). Kalibriert: **~5,65 µs
emulierte Zeit pro Schritt** → ~177.000 Schritte/s ≈ Echtzeit. Der Frame-Loop rechnet
aus dem realen Frame-Delta die Schrittzahl; `?speed=N` multipliziert sie.

## Persistenz

Ein Snapshot des WASM-Linearspeichers enthält CPU-, RAM- und LCD-Zustand und wird
base64-kodiert in `localStorage` (`tamagotchi.emu.v1`) abgelegt. Im Speed-Modus wird
nicht gespeichert.
