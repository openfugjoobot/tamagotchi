# Tamagotchi — Full-Stack

Full-Stack-Plattform: das Tamagotchi läuft **auf dem Server** in einer
WebAssembly-Emulation der echten P1-Firmware ([TamaLIB](https://github.com/jcrona/tamalib));
der Browser ist Fenster und Fernbedienung. Geräte-Optik, Buttons, Sound und PWA
drumherum.

Live: <https://tamagotchi.fugjoo.com> · Quellcode, aber **ohne** Firmware (siehe unten).

## Überblick

- **Server** (`server/`): Node/TypeScript, `fastify` + `ws`, Postgres. Treibt alle
  Tiere in einem Tick-Loop (125 ms), erkennt Tod am LCD-Bild, verschickt generische
  Beeps per Web Push.
- **Client** (`src/`): statischer Build (`dist/`), verbindet sich per WebSocket
  (`/ws`) und REST (`/api/*`) mit demselben Host.
- Architektur-Details: [ARCHITECTURE.md](./ARCHITECTURE.md) ·
  Entscheidungen [DECISIONS.md](./DECISIONS.md) · Spielregeln [GAMEPLAY.md](./GAMEPLAY.md) ·
  Konto/Auth [AUTH-SYNC.md](./AUTH-SYNC.md) · Beeps [BEEPS.md](./BEEPS.md).

## Client (Frontend) starten

```bash
npm install
npm run dev      # Dev-Server (vite)
npm run build    # Produktions-Build (dist/) + Precache-Liste für den Service Worker
npm run verify   # tsc + Tests + Build
```

## Server starten

```bash
npm run server:build   # tsc -p tsconfig.server.json → dist-server/ (+ schema.sql)
npm run server:dev     # build + node dist-server/server/src/main.js (lokal)
npm run server:test    # nur die Server-Tests
```

Postgres + Server im Container (empfohlen für den Betrieb):

```bash
docker compose -f server/docker-compose.yml up -d --build
```

Der Server kompiliert nach **`dist-server/`** (nicht `dist/`), damit ein
`vite build` — das sein `outDir` leert — den Server-Einstiegspunkt nicht löscht.

### Umgebung (`server/.env.example` → `.env`)

| Variable | Zweck |
|---|---|
| `DATABASE_URL` | Postgres-Connection-String (Pflicht) |
| `GOOGLE_CLIENT_ID` | Audience, gegen die ID-Token geprüft werden (Pflicht) |
| `VAPID_SUBJECT` / `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push (Pflicht) |
| `PORT` | HTTP-Port, Default `8080` |
| `PUBLIC_DIR` | Ordner mit `emu/rom0.bin`, `emu/rom2.bin`, `emu/tamalib.wasm` (Default: `<root>/public`) |

Secrets nie committen: lokal `.env` (gitignored), im Container
`server/.secrets/tamagotchi.env` (gitignored, `env_file` der Compose-Datei). Das
Schema (`server/src/db/schema.sql`) läuft bei jedem Boot idempotent.

### Reverse Proxy (Betrieb)

`tamagotchi.fugjoo.com` bleibt die App; der Server muss unter demselben Host
`/api/*` **und** `/ws` bedienen, wobei `/ws` **Upgrade-Support** braucht
(Standard bei Nginx Proxy Manager, im Host-Config prüfen). Der Container lauscht
intern auf `8080`, kein Host-Port.

## Firmware & WASM (nicht im Repo)

`public/emu/rom0.bin` (P1) und `rom2.bin` (P2) sind gedumpte Original-ROMs und
**urheberrechtlich geschützt** — sie liegen nicht im Repo. Erwartet werden 12 KiB
mit MD5 `3fce172403c27274e59723bbb9f6d8e9` (P1, `tama.bin` aus dem MAME-Set
`tama.zip`) bzw. `42932a81ed40be09e27c8aa1670495fc` (P2). Ohne diese Dateien und
`tamalib.wasm` **bricht der Server beim Start ab** (`missing emulator asset: …`).
Provisioning-Anleitung: [emu/README.md](../emu/README.md). Nur für privaten Gebrauch.

## Emulator bauen

Nur nötig, wenn `emu/` geändert wird (braucht Zig, kein Emscripten/Docker):

```bash
ZIG=/pfad/zu/zig bash emu/build.sh   # → public/emu/tamalib.wasm
```

## Tests

```bash
npm test            # vitest (alle)
npm run server:test # nur server-*.test.ts
npm run verify      # tsc --noEmit + vitest + vite build (+ precache)
```

Die Server-Tests laufen gegen **pg-mem** (kein Postgres nötig) und injizieren
Fake-ROM/WASM/Push-Sender. Der `emu-beep-probe`-Test simuliert zwei Tage und ist
deshalb langsam (~2 min).

### End-to-End-Probe (manuell)

`scripts/e2e-check.mjs` fährt den echten Server gegen ein echtes Postgres hoch und
treibt ihn über echtes HTTP + WebSocket: Tier anlegen → `hello` → LCD-Frames →
Beep → Push. Nur die Google-Prüfung (selbst signiertes JWKS) und der Push-Sender
(Aufzeichnungs-Stub) sind injiziert.

```bash
npm run server:build
docker run -d --name tama-e2e-pg -e POSTGRES_PASSWORD=e2epass \
  -e POSTGRES_USER=tamagotchi -e POSTGRES_DB=tamagotchi -p 127.0.0.1:55433:5432 postgres:16-alpine
DATABASE_URL='postgres://tamagotchi:e2epass@127.0.0.1:55433/tamagotchi' node scripts/e2e-check.mjs
```

## Bedienung (Client)

- **A / B / C** = linke / mittlere / rechte Taste (Klick, Touch oder Tastatur:
  `A`/`←`, `Enter`/`Space`, `→`; `Esc` schließt nur Dialoge). Der Client sendet
  **beide Flanken** als `{t:"btn", btn, down}` an den Server, der jeden
  gedrückten Pin hält — so kommt eine echte Zweifinger-Kombi (**SELECT+NEXT =
  A+C**, Ton an/aus) als *gleichzeitiger* Druck beim ROM an. Der Legacy-Tap
  `{t:"press"}` bleibt akzeptiert.
- **`?shell=pink`** — pinkes Gehäuse (Default blau). Der frühere `?speed=`-Parameter
  entfällt: die Zeit kommt jetzt vom Server.

## Bekannte Lücken

- **Slot-Laden** hat keine Server-Route: Slots lassen sich anlegen/löschen, aber
  nicht wieder in ein laufendes Tier laden.
- **Einstellungs-IDs passen nicht zusammen**: der Server erlaubt
  `theme ∈ {light,dark}` und `shell ∈ {green,blue,pink,dino}`, die UI nutzt aber
  `blossom/day/dusk/night/midnight` bzw. `teal/blue/pink/…`. Dadurch round-trippen
  nur `sound` und `push`; Theme/Shell werden nicht persistiert.
- **Kein Timeout, wenn kein Frame kommt**: bleibt der WS stumm, dreht der
  Lade-Spinner weiter (kein Fallback nach n Sekunden).

## Lizenzen

- Dieses Projekt steht unter **GPLv2** (siehe [`../LICENSE`](../LICENSE)) — weil
  TamaLIB, auf dem die Emulation basiert, GPLv2 ist. Copyright (C) 2026 fugjoo.
- Die P1/P2-ROMs sind nicht enthalten; die Icon-Grafiken stammen aus
  [`GMMan/flipperzero-tamagotch-p1`](https://github.com/GMMan/flipperzero-tamagotch-p1)
  (Lizenz dort unklar).
