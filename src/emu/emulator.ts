export const LCD_WIDTH = 32;
export const LCD_HEIGHT = 16;
export const ICON_COUNT = 8;

/** P1-Buttons: A=left, B=middle, C=right. */
export type Btn = "left" | "middle" | "right";
const BTN_INDEX: Record<Btn, number> = { left: 0, middle: 1, right: 2 };

export interface Emulator {
  step(n?: number): void;
  setButton(b: Btn, down: boolean): void;
  lcd(): Uint8Array;
  icons(): Uint8Array;
  buzzer(): { freq: number; on: boolean };
  now(): number;
  saveState(): Uint8Array;
  loadState(buf: Uint8Array): void;
}

interface RawExports {
  memory: WebAssembly.Memory;
  emu_rom_byte(i: number, v: number): void;
  emu_init(): void;
  emu_step(): void;
  emu_set_button(btn: number, state: number): void;
  emu_lcd(): number;
  emu_icons(): number;
  emu_freq(): number;
  emu_en(): number;
  emu_now(): number;
}

export interface EmulatorOptions {
  wasm: ArrayBuffer | Uint8Array;
  rom: Uint8Array;
}

export async function createEmulator(opts: EmulatorOptions): Promise<Emulator> {
  const module = await WebAssembly.compile(opts.wasm as BufferSource);
  const instance = await WebAssembly.instantiate(module, {});
  const ex = instance.exports as unknown as RawExports;

  for (let i = 0; i < opts.rom.length; i++) ex.emu_rom_byte(i, opts.rom[i]);
  ex.emu_init();

  const lcdPtr = ex.emu_lcd();
  const iconsPtr = ex.emu_icons();

  // Speicher-Views bei einem möglichen memory.grow neu binden.
  let mem = new Uint8Array(ex.memory.buffer);
  const refresh = () => { if (mem.buffer !== ex.memory.buffer) mem = new Uint8Array(ex.memory.buffer); };

  return {
    step(n = 1) { for (let i = 0; i < n; i++) ex.emu_step(); },
    setButton(b, down) { ex.emu_set_button(BTN_INDEX[b], down ? 1 : 0); },
    lcd() { refresh(); return mem.subarray(lcdPtr, lcdPtr + LCD_WIDTH * LCD_HEIGHT); },
    icons() { refresh(); return mem.subarray(iconsPtr, iconsPtr + ICON_COUNT); },
    buzzer() { return { freq: ex.emu_freq(), on: ex.emu_en() !== 0 }; },
    now() { return ex.emu_now(); },
    saveState() { refresh(); return mem.slice(); },
    loadState(buf) {
      refresh();
      if (buf.length === mem.length) mem.set(buf);
      else throw new Error(`state size mismatch: ${buf.length} != ${mem.length}`);
    },
  };
}
