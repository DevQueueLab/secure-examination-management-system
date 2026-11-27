import { createHash } from 'node:crypto';

/** Deterministic PRNG (mulberry32) seeded from a string, so any candidate's paper can be reproduced exactly. */
export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  shuffle<T>(items: readonly T[]): T[];
  pick<T>(items: readonly T[]): T;
}

export function createRng(seed: string): Rng {
  let a = createHash('sha256').update(seed).digest().readUInt32LE(0);
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number) => Math.floor(next() * max);
  return {
    next,
    int,
    shuffle<T>(items: readonly T[]) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    pick<T>(items: readonly T[]) {
      return items[int(items.length)]!;
    },
  };
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
