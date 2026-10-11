import { it } from "vitest";
import { createFramebuffer } from "@/render/canvas";
import { renderScreen } from "@/render/screen";
import { createInitialState } from "@/engine/state";
import type { GameState } from "@/engine/types";

function ascii(fb: { width: number; height: number; get(x: number, y: number): boolean }): string {
  let out = "";
  for (let y = 0; y < fb.height; y++) {
    let line = "";
    for (let x = 0; x < fb.width; x++) line += fb.get(x, y) ? "#" : " ";
    out += line + "\n";
  }
  return out;
}

function show(title: string, st: GameState) {
  const fb = createFramebuffer();
  renderScreen(fb, st, 1000);
  console.log(`\n=== ${title} ===\n${ascii(fb)}`);
}

it("ascii dump", () => {
  show("EGG (idle)", createInitialState(0, 42));
  show("CHILD idle", {
    ...createInitialState(0, 42), stage: "CHILD", character: "marutchi",
    poops: 1, flags: { sleeping: false, misbehaving: false, sick: false, attention: true },
  });
  show("CHILD menu (feed selected)", {
    ...createInitialState(0, 42), stage: "CHILD", character: "marutchi",
    menu: { mode: "iconSelect", selection: "feed", sub: null, meterPage: 0 },
  });
});
