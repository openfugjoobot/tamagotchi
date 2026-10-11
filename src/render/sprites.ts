import type { IconId } from "../engine/types";

// ---- Charakter-Sprites (Linien-Stil: # = Pixel an) ----
// 10 breit × 10 hoch. Ohren + Gesicht machen das Wesen erkennbar.

const EGG = [
  "...####...",
  "..######..",
  ".#......#.",
  "#...##...#",
  "#........#",
  "#..##....#",
  "#........#",
  "#.....##.#",
  ".#......#.",
  "..######..",
];

const EYES = "#.#....#.#";
const MOUTH_SMALL = "#...##...#";
const MOUTH_WIDE = "#..####..#";

function creature(opts: { ears: boolean; eyes: string; mouth: string }): string[] {
  const head = opts.ears
    ? ["..#....#..", ".##....##."]
    : ["..######..", ".#......#."];
  return [
    ...head,
    "..######..",
    ".#......#.",
    opts.eyes,
    opts.eyes,
    "#........#",
    opts.mouth,
    ".#......#.",
    "..######..",
  ];
}

export const SPRITES: Record<string, string[]> = {
  egg: EGG,
  poop: [".##.", "####", "####", ".##."],
  skull: [".##.", "####", "#..#", "####", ".##."],
  babytchi: creature({ ears: false, eyes: EYES, mouth: MOUTH_SMALL }),
  marutchi: creature({ ears: true, eyes: EYES, mouth: MOUTH_SMALL }),
  tamatchi_v1: creature({ ears: true, eyes: EYES, mouth: MOUTH_WIDE }),
  tamatchi_v2: creature({ ears: true, eyes: EYES, mouth: MOUTH_WIDE }),
  kuchitamatchi_v1: creature({ ears: true, eyes: EYES, mouth: MOUTH_WIDE }),
  kuchitamatchi_v2: creature({ ears: true, eyes: EYES, mouth: MOUTH_WIDE }),
  mametchi: creature({ ears: true, eyes: EYES, mouth: MOUTH_SMALL }),
  ginjirotchi: creature({ ears: true, eyes: EYES, mouth: MOUTH_SMALL }),
  maskutchi: creature({ ears: true, eyes: EYES, mouth: MOUTH_WIDE }),
  kuchipatchi: creature({ ears: true, eyes: EYES, mouth: MOUTH_WIDE }),
  nyorotchi: creature({ ears: true, eyes: EYES, mouth: MOUTH_SMALL }),
  tarakotchi: creature({ ears: true, eyes: EYES, mouth: MOUTH_WIDE }),
  bill: creature({ ears: true, eyes: EYES, mouth: MOUTH_SMALL }),
  oyajitchi: creature({ ears: true, eyes: EYES, mouth: MOUTH_SMALL }),
};

// ---- Menü-Icons (4 breit × 6 hoch) ----
export const ICONS: Record<IconId, string[]> = {
  feed: ["#.#.", "###.", "#.#.", "..#.", "..#.", "..#."],
  light: [".##.", "#..#", "#..#", ".##.", "..#.", ".##."],
  play: [".##.", "#..#", "#..#", "#..#", ".##.", "...."],
  medicine: ["..#.", "..#.", "###.", "..#.", "..#.", "..#."],
  duck: [".##.", "..##", "###.", "###.", "....", "...."],
  meter: ["#.#.", "#.#.", "#.#.", "#.#.", "#.#.", "###."],
  discipline: ["#...", "##..", "###.", "##..", "#...", "...."],
  attention: ["..#.", ".##.", "###.", ".#..", "#...", "...."],
};
