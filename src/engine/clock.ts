export interface Clock { now(): number }

export function createClock(): Clock {
  return { now: () => Date.now() };
}

export interface FixedClock extends Clock { set(ms: number): void }

export function createFixedClock(ms: number): FixedClock {
  let t = ms;
  return { now: () => t, set: (v) => { t = v; } };
}
