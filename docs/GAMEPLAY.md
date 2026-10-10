# Gameplay

Menschliche Referenz der Spielregeln. Alle Zahlenwerte stehen in
`src/engine/config.ts`.

## Bedürfnisse

- **Hungry / Happy:** je 0–4 Herzen. Verlieren im Wachzustand je nach Stufe
  Herzen in festen Intervallen; nie unter 0.
- **Gewicht:** Minimum je Form (Babytchi 5, Marutchi 10, Teen 20, Adult 30),
  Maximum 99. Meal +1, Snack +2, Spielen −1.
- **Poop:** erscheint in Intervallen (Adult ~3 h), max 4. Bei 4 Poops wird das
  Tamagotchi krank. „Duck" (Reinigen) entfernt alle.
- **Schlaf:** je Charakter eine Bettzeit (Gerätezeit). Beim Aufwachen zählt ein
  Lebensjahr hoch. Licht muss beim Schlafen aus sein.
- **Discipline:** 0 / 25 / 50 / 75 / 100 %. Beim „Misbehaving" erhöht Ausschimpfen
  um 25 %.
- **Krankheit:** Babytchi wird nach ~33 min krank; sonst durch zu viele Poops.
  Zwei Medizingaben heilen. Zu lange unbehandelt ⇒ Tod.

## Evolution (Growth-Chart)

**BABY → MARUTCHI:** immer.

**MARUTCHI → Teen** (care mistakes / discipline):

| cm | disc ≥75 | disc ≤50 |
|----|----------|----------|
| 0–1 | Tamatchi v1 | Tamatchi v2 |
| 2+ | Kuchitamatchi v1 | Kuchitamatchi v2 |

**TEEN → ADULT:**

| Teen | cm | disc 100 | disc 75 | disc ≤50 |
|------|----|----------|---------|----------|
| Tamatchi v1 | 0–2 | Mametchi | Ginjirotchi | Maskutchi |
| Tamatchi v1 | 3+ | Kuchipatchi | Nyorotchi | Tarakotchi |
| Tamatchi v2 | 0–2 | Ginjirotchi | Maskutchi | Maskutchi |
| Tamatchi v2 | 3+ | Nyorotchi | Tarakotchi | Tarakotchi |
| Kuchitamatchi v1 | 0–2 | Kuchipatchi | Nyorotchi | Tarakotchi |
| Kuchitamatchi v2 | 0–2 | Nyorotchi | Tarakotchi | Tarakotchi |

**HIDDEN:** Maskutchi mit 0 % Discipline, der Alter 10 erreicht ⇒ **Bill**
(EN) / **Oyajitchi** (JP).

## Menü

`FEED · LIGHT · PLAY · MEDICINE · DUCK(clean) · METER(status) · DISCIPLINE(scold)`

- **FEED:** Meal/Snack.
- **LIGHT:** An/Aus.
- **PLAY:** 5 Runden, `A`=links `B`=rechts; Sieg ≥3 Runden ⇒ +1 Happy.
- **MEDICINE:** wiederholt bis gesund.
- **DUCK:** reinigt.
- **METER:** Status-Seiten (Alter/Gewicht, Discipline, Hungry, Happy).
- **DISCIPLINE:** Ausschimpfen.

## Tod & Neustart

Tod durch Alter (Basis-Lebensdauer abzüglich Care Mistakes) oder unbehandelte
Krankheit. Auf dem Tod-Screen startet `A`+`C` ein neues Ei.
