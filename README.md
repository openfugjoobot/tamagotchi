# Tamagotchi P1 — in the browser

The original 1996 Tamagotchi P1 firmware, running in the browser via a WebAssembly
emulation ([TamaLIB](https://github.com/jcrona/tamalib)). Device shell, buttons,
sound and PWA around it.

**Live:** <https://tamagotchi.fugjoo.com>

## Quick start

```bash
npm install
npm run dev      # dev server
npm run verify   # tsc + tests + build
```

The original firmware dump (`public/emu/rom0.bin`) is **not** in this repository —
it is copyrighted and has to be provided by you (12 KiB, MD5
`3fce172403c27274e59723bbb9f6d8e9`, private use only).

Full manual: [docs/README.md](./docs/README.md) ·
[architecture](./docs/ARCHITECTURE.md) · [decisions](./docs/DECISIONS.md)

## Licence

This project is licensed under the **GNU General Public License v2.0** — see
[LICENSE](./LICENSE). TamaLIB, which the emulation is built on, is GPLv2 as well.
Copyright (C) 2026 fugjoo.

The P1 firmware is not distributed here; icon artwork comes from
[`GMMan/flipperzero-tamagotch-p1`](https://github.com/GMMan/flipperzero-tamagotch-p1).
