# Entscheidungen

## Quellen

Recherche zum klassischen P1 (1996/97) — **nicht** die Rerelease-Varianten 2017/18:

- thaao.net/tama/p1 (Care Guide + Character Guide)
- tamatalk.com P1/P2 Evolution Guide
- tamagotchi.fandom.com (Life Cycle)

## Bewusste Näherungen

- **Baby-Evolution:** 65 min (Quellen nennen teils 60 vs. 65 min). Zentral in
  `config.stages.BABY.durationMs`, in Tests fixiert.
- **Child/Teen-Grenzen:** altersbasiert (`ageYears >= 3` bzw. `>= 6`) statt
  exakter Aufwach-Zählung des Originals. In `config.stages` konfiguriert.
- **Hidden-Charakter:** Default **Bill** (EN); Oyajitchi per Konfig-Flag.
- **Growth-Chart-Grenzfälle:** wo die Quellen unscharf sind, ist die Regel
  explizit in `config.ts`/`lifecycle.ts` festgeschrieben und per Tabellentests
  abgedeckt.

## Rendering

32×16-LCD-Logikauflösung, Integer-Scaling, `imageSmoothingEnabled = false`.
Die Sprite-Pixelkunst ist zunächst als Gerüst angelegt (Struktur + Breite ≤ 32
getestet) und wird beim Spielen verfeinert.

## Sound

Prozedurale WebAudio-Beeps statt Audiodateien. Mute via `A`+`C`, Zustand wird
im Save persistiert.

## Restrisiko: Uhr-Manipulation

Die Geräteuhr des Nutzers lässt sich nicht vollständig gegen Manipulation
absichern; negative Zeitdifferenzen werden geklemmt. Bewusst als Restrisiko
akzeptiert.

## Sprite-Copyright

Es werden Original-Gen1-Sprites verwendet. Die App ist **nur für privaten
Gebrauch** und wird nicht öffentlich distribuiert.
