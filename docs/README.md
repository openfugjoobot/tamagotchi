# Tamagotchi P1 (Emulator)

Originalgetreue P1-Emulation im Browser: Die **echte Firmware** läuft in einer
WASM-Emulation ([TamaLIB](https://github.com/jcrona/tamalib)) — Logik, Menü, Icons,
Animation und Timing sind damit 1:1 das Original. Geräte-Optik, Buttons, Sound und
PWA drumherum.

Live: <https://tamagotchi.fugjoo.com> · Quellcode, aber **ohne** Firmware (siehe unten).

## Start

```bash
npm install
npm run dev      # Dev-Server
npm run build    # Produktions-Build (dist/) + Precache-Liste für den Service Worker
npm run verify   # tsc + Tests + Build
```

## Firmware (nicht im Repo)

`public/emu/rom0.bin` ist ein gedumptes Original-P1-ROM und **urheberrechtlich
geschützt** — es liegt deshalb nicht im Repo und muss selbst bereitgestellt werden.
Erwartet wird ein 12 KiB ROM mit MD5 `3fce172403c27274e59723bbb9f6d8e9`
(z. B. `tama.bin` aus dem MAME-Set `tama.zip`) als `public/emu/rom0.bin`.
Nur für privaten Gebrauch.

## Emulator bauen

Nur nötig, wenn `emu/` geändert wird (braucht Zig, kein Emscripten/Docker):

```bash
ZIG=/pfad/zu/zig bash emu/build.sh   # → public/emu/tamalib.wasm
```

## Bedienung

- **A / B / C** = linke / mittlere / rechte Taste (Klick, Touch oder Tastatur:
  `A`/`←`, `Enter`/`Space`, `→`; `Esc` schließt nur Dialoge).
- **`?speed=N`** — Emulation N× schneller (z. B. `?speed=600`).
- **`?shell=pink`** — pinkes Gehäuse (Default blau).

## Aufbau

```
emu/         C→WASM-Build (TamaLIB + HAL-Glue, Zig)
public/emu/  tamalib.wasm (+ rom0.bin, selbst bereitstellen)
src/emu/     TS-Wrapper, Input-Map, Piezo-Audio, Zeitmodell (clock.ts)
src/render/  LCD-Canvas, Icon-Leiste
src/storage/ Emulator-Snapshot + localStorage-Keys
src/theme.ts Hintergrund-Themes (Start + Guide)
src/ui/      Geräte-Gehäuse
src/main.ts  Verdrahtung (Frame-Loop, Buttons, Sound, Save, Nachhol-Logik)
src/pwa.ts   PWA-Lifecycle: SW-Updates, Offline-Status, Installation, Badge, Wake Lock
```

## PWA

Die App ist installierbar und offline lauffähig. Was sie mitbringt:

| Thema | Umsetzung |
| --- | --- |
| Offline-Start | `sw.js` precached beim Install alle Build-Artefakte (`precache.json`) |
| Caching | Netz-zuerst für HTML, Cache-zuerst für gehashte Assets/ROM/WASM, Stale-while-revalidate für den Rest |
| Offline-Fallback | `/offline.html` bei fehlgeschlagener Navigation |
| Updates | Neue Version **wartet** auf Freigabe; die Seite bietet einen Reload an. Kein Auto-Reload mitten im Spiel. |
| Version | Build-Hash über alle Artefakte, beim Build in `sw.js` gestempelt und im Footer sichtbar |
| Installation | `beforeinstallprompt` + eigener Dialog mit Anleitung (iOS-Variante für Safari) |
| Speicher | `navigator.storage.persist()` schützt den Spielstand vor Räumung; Belegung im Konto-Panel |
| Badge | `setAppBadge()`, wenn das Tier Aufmerksamkeit braucht (zuschaltbar) |
| Wake Lock | Bildschirm bleibt wach, solange der Tab offen ist (zuschaltbar) |
| Sync | Background Sync / Periodic Sync holen den Cloud-Push nach |

Die Version wird **nicht** von Hand gepflegt: `scripts/gen-precache.mjs` hasht nach
dem Build alle Dateien und ersetzt `__SW_VERSION__` in `dist/sw.js`. Ändert sich
nichts, bleibt der Hash gleich.

Weiter: [ARCHITECTURE.md](./ARCHITECTURE.md) · [DECISIONS.md](./DECISIONS.md) ·
[GAMEPLAY.md](./GAMEPLAY.md)

## Lizenzen

- Dieses Projekt steht unter **GPLv2** (siehe [`../LICENSE`](../LICENSE)) — weil
  [TamaLIB](https://github.com/jcrona/tamalib), auf dem die Emulation basiert,
  GPLv2 ist. Copyright (C) 2026 fugjoo.
- Das P1-ROM ist nicht enthalten (siehe oben), die Icon-Grafiken stammen aus
  [`GMMan/flipperzero-tamagotch-p1`](https://github.com/GMMan/flipperzero-tamagotch-p1)
  (Lizenz dort unklar).
