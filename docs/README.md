# Tamagotchi Gen-1 Nachbau (Web/PWA)

Originalgetreue Nachbildung des klassischen **Tamagotchi Gen 1 (P1, 1996/97)** als
leichtgewichtige Web-App/PWA. Nur für privaten Gebrauch.

## Installation & Start

```bash
npm install
npm run dev      # Dev-Server (Vite)
npm run build    # Produktions-Build nach dist/
npm run preview  # Build lokal testen
npm run test     # Test-Suite (Vitest)
```

## Bedienung

- **Tasten A / B / C** (anklickbar oder Tastatur):
  - `A` / `←` = A · `Enter` / `Space` = B · `Esc` / `→` = C
- **Menü:** ohne Auswahl `A` öffnet die Icon-Auswahl, `B` zeigt die Uhr,
  `A`+`C` zusammen schaltet den Ton.
- **Neustart:** nach dem Tod `A`+`C`.

## Projektstruktur

```
src/
  engine/    Reine Spiellogik (Zustand, Simulation, Evolution) — deterministisch testbar
  render/    Canvas-2D-LCD-Framebuffer (32×16), Sprites, Icons, Kompositor
  input/     A/B/C-Tasten und Menü-State-Machine
  audio/     Prozeduraler WebAudio-Beeper
  storage/   Versionierte localStorage-Persistenz + Autosave
  ui/        Geräte-Gehäuse (CSS)
  main.ts    Verdrahtung aller Module
public/      PWA-Manifest, Service Worker, Icons
tests/       Vitest-Suites
docs/        README, ARCHITECTURE, GAMEPLAY, DECISIONS
```

Weiter: [ARCHITECTURE.md](./ARCHITECTURE.md) · [GAMEPLAY.md](./GAMEPLAY.md) · [DECISIONS.md](./DECISIONS.md)
