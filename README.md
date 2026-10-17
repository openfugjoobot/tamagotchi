# Tamagotchi — Full-Stack (P1/P2)

The original 1996 Tamagotchi firmware, running **on a server** via a WebAssembly
emulation ([TamaLIB](https://github.com/jcrona/tamalib)). The pet keeps living
with the browser closed; the browser is window and remote control. Device shell,
buttons, Web Push and a PWA around it.

**Live:** <https://tamagotchi.fugjoo.com>

## Quick start

### Client (static frontend)

```bash
npm install
npm run dev      # dev server
npm run build    # production build (dist/) + service-worker precache list
npm run verify   # tsc + tests + build
```

### Server (Node + Postgres)

```bash
npm run server:build   # compile to dist-server/
npm run server:dev     # build + run locally
docker compose -f server/docker-compose.yml up -d --build   # or in containers
```

Environment (see `server/.env.example`): `DATABASE_URL`, `GOOGLE_CLIENT_ID`,
`VAPID_SUBJECT`/`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`, optional `PORT`/`PUBLIC_DIR`.
The schema is applied idempotently on every boot.

## Firmware (not in this repository)

`public/emu/rom0.bin` and `rom2.bin` are dumped original ROMs and **copyrighted** —
they are not in the repo and must be provided by you (12 KiB each; MD5
`3fce172403c27274e59723bbb9f6d8e9` for P1, `42932a81ed40be09e27c8aa1670495fc` for
P2; private use only). Without them and `tamalib.wasm`, the server refuses to boot.
See [emu/README.md](./emu/README.md).

## Full manual

[docs/README.md](./docs/README.md) · [architecture](./docs/ARCHITECTURE.md) ·
[decisions](./docs/DECISIONS.md) · [gameplay](./docs/GAMEPLAY.md) ·
[auth & sync](./docs/AUTH-SYNC.md) · [beeps](./docs/BEEPS.md)

## Known gaps

Slot loading has no server route; server settings ids and UI ids do not match
(only `sound`/`push` persist); no timeout when the live socket never delivers a
frame.

## Licence

This project is licensed under the **GNU General Public License v2.0** — see
[LICENSE](./LICENSE). TamaLIB, which the emulation is built on, is GPLv2 as well.
Copyright (C) 2026 fugjoo.

The firmware is not distributed here; icon artwork comes from
[`GMMan/flipperzero-tamagotch-p1`](https://github.com/GMMan/flipperzero-tamagotch-p1).
