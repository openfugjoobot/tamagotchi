import type { IconId } from "../engine/types";

// ---- Charakter-Sprites (Linien-Stil: # = Pixel an) ----
// 16 breit × 14 hoch. Ohren + Gesicht machen das Wesen erkennbar.

const blank = "................";

function creature(ears: string[], eyes: string, mouth: string): string[] {
  return [
    ...ears,
    "...##########...",
    "..#..........#..",
    ".#............#.",
    eyes,
    eyes,
    ".#............#.",
    mouth,
    ".#............#.",
    "..#..........#..",
    "...##########...",
    "....########....",
    blank,
  ];
}

const EARS_2 = [
  "..##........##..",
  "..####....####..",
];
const NO_EARS = [
  "................",
  "....########....",
];

const EYES = ".#..##....##..#.";
const MOUTH_SMALL = ".#....####....#.";
const MOUTH_WIDE = ".#...######...#.";

const EGG = [
  "......####......",
  "....########....",
  "...##########...",
  "..#..........#..",
  "..#..........#..",
  "..#..........#..",
  "..#..........#..",
  "..#..........#..",
  "..#..........#..",
  "..#..........#..",
  "..#..........#..",
  "...##########...",
  "....########....",
  "................",
];

export const SPRITES: Record<string, string[]> = {
  egg: EGG,
  poop: [".##.", "####", "####", ".##."],
  skull: [".##.", "####", "#..#", "####", ".##."],
  babytchi: creature(NO_EARS, EYES, MOUTH_SMALL),
  marutchi: creature(EARS_2, EYES, MOUTH_SMALL),
  tamatchi_v1: creature(EARS_2, EYES, MOUTH_WIDE),
  tamatchi_v2: creature(EARS_2, EYES, MOUTH_WIDE),
  kuchitamatchi_v1: creature(EARS_2, EYES, MOUTH_WIDE),
  kuchitamatchi_v2: creature(EARS_2, EYES, MOUTH_WIDE),
  mametchi: creature(EARS_2, EYES, MOUTH_SMALL),
  ginjirotchi: creature(EARS_2, EYES, MOUTH_SMALL),
  maskutchi: creature(EARS_2, EYES, MOUTH_WIDE),
  kuchipatchi: creature(EARS_2, EYES, MOUTH_WIDE),
  nyorotchi: creature(EARS_2, EYES, MOUTH_SMALL),
  tarakotchi: creature(EARS_2, EYES, MOUTH_WIDE),
  bill: creature(EARS_2, EYES, MOUTH_SMALL),
  oyajitchi: creature(EARS_2, EYES, MOUTH_SMALL),
};

// ---- Menü-Icons (6 breit × 7 hoch) ----
export const ICONS: Record<IconId, string[]> = {
  // Napf (Futter)
  feed: ["......", "#....#", "######", "######", ".####.", "......", "......"],
  // Glühbirne
  light: ["..##..", ".####.", "#....#", "#....#", ".####.", "..##..", "..##.."],
  // Ball
  play: ["..##..", ".####.", "######", "######", ".####.", "..##..", "......"],
  // Kreuz (Medizin)
  medicine: ["..##..", "..##..", "######", "######", "..##..", "..##..", "......"],
  // Ente
  duck: ["..##..", ".#..#.", "..##..", "####..", ".##...", "......", "......"],
  // Balken (Status)
  meter: ["#..#..", "#..#..", "#..##.", "##.##.", "##.##.", "######", "......"],
  // Megafon (Disziplin)
  discipline: ["#.....", "##....", "###...", "####..", "###...", "##....", "#....."],
  // Aufmerksamkeit (Blitz)
  attention: ["...#..", "..##..", ".##...", "####..", "..##..", ".##...", "##...."],
};
