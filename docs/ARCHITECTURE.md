# Architektur

Die App ist strikt in Schichten getrennt. Die Engine ist reine, deterministische
Logik ohne DOM, Netzwerk oder `Date.now()` — Zeit wird immer als `nowMs`-Parameter
injiziert, Zufall über einen seeded PRNG. Dadurch ist alles mit `vitest` testbar.

## Module

| Modul | Verantwortung |
|-------|----------------|
| `engine/types.ts` | `GameState` und zugehörige Typen |
| `engine/config.ts` | **Single source of truth** aller Regeln, Zeiten, Tabellen |
| `engine/rng.ts` | Seeded PRNG (Mulberry32) |
| `engine/clock.ts` | Injizierbare Uhr (`createClock`, `createFixedClock`) |
| `engine/state.ts` | Initialzustand, Serialisierung, Schema-Migration |
| `engine/simulation.ts` | `advance(state, nowMs)` — Decay, Poop, Schlaf, Krankheit, Tod |
| `engine/lifecycle.ts` | Stufenwechsel & Evolutions-Growth-Chart |
| `engine/actions.ts` | `applyAction` — feed/play/light/medicine/clean/scold/attention |
| `render/*` | LCD-Framebuffer 32×16, Sprites, Icons, Kompositor, Animationen |
| `input/*` | A/B/C-Tasten, Tastatur-Mapping, Menü-State-Machine |
| `audio/sound.ts` | Prozedurale Beeps |
| `storage/persist.ts` | Save/Load/Autosave in `localStorage` |
| `main.ts` | Verdrahtung: Clock → Engine → Renderer, Input, Sound, Persistenz |

## Datenfluss

```
Button/Key ──▶ input/menus.pressButton ──▶ Action
                                  │
Clock.now() ──▶ engine/simulation.advance ──▶ GameState ──▶ render/screen ──▶ Canvas
                                  │                    │
                    engine/lifecycle.maybeEvolve   storage/persist (Autosave)
```

1. Jeder Frame ruft `advance()` (zeitbasierter Catch-up) und `maybeEvolve()` auf.
2. Buttons erzeugen über `pressButton` eine `Action`, die `applyAction` anwendet.
3. Nach jeder Änderung wird der Zustand debounced gespeichert.
4. `main.ts` rendert den Zustand in den Framebuffer und blittet ihn integer-skaliert.

## Anti-Cheat / Zeit

`advance()` rechnet analytisch mit Wall-Clock-Timestamps statt pro Tick zu loopen.
App-Neustart bringt daher keinen Vorteil. Negatives `elapsed` wird geklemmt.
Der Uhr-Set-Mode pausiert die Simulation. Geräteuhr-Manipulation ist Restrisiko
(siehe [DECISIONS.md](./DECISIONS.md)).
