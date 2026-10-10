import { describe, it, expect } from "vitest";
import { resolveMarutchiToTeen, resolveTeenToAdult } from "@/engine/lifecycle";

describe("marutchi → teen", () => {
  it.each([
    [0, 100, "tamatchi_v1"], [1, 75, "tamatchi_v1"],
    [0, 50, "tamatchi_v2"], [2, 100, "kuchitamatchi_v1"],
    [3, 0, "kuchitamatchi_v2"],
  ] as const)("cm=%i disc=%i ⇒ %s", (cm, disc, exp) => {
    expect(resolveMarutchiToTeen(cm, disc)).toBe(exp);
  });
});

describe("teen → adult", () => {
  it.each([
    ["tamatchi_v1", 0, 100, "mametchi"],
    ["tamatchi_v1", 0, 75, "ginjirotchi"],
    ["tamatchi_v1", 0, 50, "maskutchi"],
    ["tamatchi_v1", 3, 100, "kuchipatchi"],
    ["tamatchi_v1", 3, 75, "nyorotchi"],
    ["tamatchi_v1", 3, 50, "tarakotchi"],
    ["tamatchi_v2", 0, 100, "ginjirotchi"],
    ["tamatchi_v2", 0, 75, "maskutchi"],
    ["tamatchi_v2", 3, 100, "nyorotchi"],
    ["tamatchi_v2", 3, 0, "tarakotchi"],
    ["kuchitamatchi_v1", 0, 100, "kuchipatchi"],
    ["kuchitamatchi_v1", 0, 75, "nyorotchi"],
    ["kuchitamatchi_v1", 0, 50, "tarakotchi"],
    ["kuchitamatchi_v2", 0, 100, "nyorotchi"],
    ["kuchitamatchi_v2", 0, 75, "tarakotchi"],
  ] as const)("%s cm=%i disc=%i ⇒ %s", (teen, cm, disc, exp) => {
    expect(resolveTeenToAdult(teen, cm, disc)).toBe(exp);
  });
});
