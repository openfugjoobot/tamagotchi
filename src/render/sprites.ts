import type { IconId } from "../engine/types";

// ---- Charakter-Sprites (Linien-Stil: # = Pixel an) ----

const EGG = [
  "..######..",
  ".#......#.",
  "#........#",
  "#........#",
  "#........#",
  "#........#",
  ".#......#.",
  "..######..",
];

// Gesicht: runder Umriss, zwei Augen, Mund.
function face(eye: string, mouth: string): string[] {
  return [
    "..######..",
    ".#......#.",
    eye,
    eye,
    "#........#",
    mouth,
    ".#......#.",
    "..######..",
  ];
}

const EYES_OPEN = "#.#....#.#";
const EYES_SMILE = "#.#....#.#";
const MOUTH_SMALL = "#...##...#";
const MOUTH_WIDE = "#..####..#";

export const SPRITES: Record<string, string[]> = {
  egg: EGG,
  poop: [".##.", "####", "####", ".##."],
  skull: [".##.", "####", "#..#", "####", ".##."],
  babytchi: face(EYES_OPEN, MOUTH_SMALL),
  marutchi: face(EYES_OPEN, MOUTH_SMALL),
  tamatchi_v1: face(EYES_SMILE, MOUTH_WIDE),
  tamatchi_v2: face(EYES_SMILE, MOUTH_WIDE),
  kuchitamatchi_v1: face(EYES_OPEN, MOUTH_WIDE),
  kuchitamatchi_v2: face(EYES_OPEN, MOUTH_WIDE),
  mametchi: face(EYES_SMILE, MOUTH_SMALL),
  ginjirotchi: face(EYES_SMILE, MOUTH_SMALL),
  maskutchi: face(EYES_OPEN, MOUTH_WIDE),
  kuchipatchi: face(EYES_SMILE, MOUTH_WIDE),
  nyorotchi: face(EYES_OPEN, MOUTH_SMALL),
  tarakotchi: face(EYES_SMILE, MOUTH_WIDE),
  bill: face(EYES_OPEN, MOUTH_SMALL),
  oyajitchi: face(EYES_SMILE, MOUTH_SMALL),
};

// ---- Menü-Icons (4 breit × 6 hoch) ----
export const ICONS: Record<IconId, string[]> = {
  // Gabel (Futter)
  feed: ["#.#.", "###.", "#.#.", "..#.", "..#.", "..#."],
  // Glühbirne
  light: [".##.", "#..#", "#..#", ".##.", "..#.", ".##."],
  // Ball
  play: [".##.", "#..#", "#..#", "#..#", ".##.", "...."],
  // Kreuz (Medizin)
  medicine: ["..#.", "..#.", "###.", "..#.", "..#.", "..#."],
  // Ente
  duck: [".##.", "..##", "###.", "###.", "....", "...."],
  // Balken (Status)
  meter: ["#.#.", "#.#.", "#.#.", "#.#.", "#.#.", "###."],
  // Megafon (Disziplin)
  discipline: ["#...", "##..", "###.", "##..", "#...", "...."],
  // Aufmerksamkeit (Blitz)
  attention: ["..#.", ".##.", "###.", ".#..", "#...", "...."],
};
