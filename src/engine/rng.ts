export interface Rng {
  readonly seed: number;
  next(): number;
  nextInt(maxExclusive: number): number;
}

// Mulberry32 — klein, deterministisch, ausreichend für Spielzwecke.
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed,
    next,
    nextInt: (max) => Math.floor(next() * max),
  };
}
