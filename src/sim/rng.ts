/**
 * Seeded RNG. The only source of randomness allowed anywhere in this project —
 * `Math.random` is banned (see CLAUDE.md and rng.test.ts).
 *
 * mulberry32: 32-bit state, integer ops only, so it produces the identical
 * stream on every platform and Node version.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
}

export function mulberry32(seed: number): Rng {
  let state = seed | 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    chance: (p) => next() < p,
  };
}
