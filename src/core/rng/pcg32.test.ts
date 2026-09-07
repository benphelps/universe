import { describe, expect, it } from 'vitest';
import { Pcg32 } from './pcg32';
import { mix64 } from './hash';

/** Independent arbitrary-precision PCG reference, retained to protect
 * seed compatibility when optimizing the integer implementation. */
function reference(seed: bigint, stream: bigint): () => number {
  const mask = (1n << 64n) - 1n, inc = ((stream << 1n) | 1n) & mask;
  let state = 0n;
  const next = () => {
    const old = state;
    state = (old * 6364136223846793005n + inc) & mask;
    const x = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
    const rot = Number(old >> 59n);
    return ((x >>> rot) | (x << (-rot & 31))) >>> 0;
  };
  next();
  state = (state + seed) & mask;
  next();
  return next;
}

describe('PCG32 integer implementation', () => {
  it('matches the reference across carries, rotations, streams and wrapped seeds', () => {
    const seeds = [0n, 1n, -1n, 0xffffffffn, 0x100000000n, 0xffffffffffffffffn, 1n << 80n,
      ...Array.from({ length: 48 }, (_, i) => mix64(BigInt(i)))];
    for (const [index, seed] of seeds.entries()) {
      const stream = index % 3 === 0 ? -seed : index % 3 === 1 ? 0n : mix64(seed);
      const actual = new Pcg32(seed, stream), expected = reference(seed, stream);
      const values = Array.from({ length: 2048 }, () => actual.nextUint32());
      expect(values).toEqual(Array.from({ length: 2048 }, expected));
    }
  });
  it('keeps float conversion identical and advances only once', () => {
    const actual = new Pcg32(42n, 54n), expected = reference(42n, 54n);
    for (let i = 0; i < 1000; i++) expect(actual.nextFloat()).toBe(expected() * 2 ** -32);
  });
});
