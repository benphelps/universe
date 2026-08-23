import { describe, expect, it } from 'vitest';
import { deriveSeed, seedFromHex, seedToHex } from './hash';
import { brokenPowerLaw, powerLaw } from './distributions';
import { Rng } from './rng';

describe('seed derivation', () => {
  it('is deterministic and tag/index sensitive', () => {
    const parent = 0x123456789abcdef0n;
    expect(deriveSeed(parent, 'star', 0)).toBe(deriveSeed(parent, 'star', 0));
    expect(deriveSeed(parent, 'star', 0)).not.toBe(deriveSeed(parent, 'star', 1));
    expect(deriveSeed(parent, 'star', 0)).not.toBe(deriveSeed(parent, 'planet', 0));
  });

  it('round-trips through hex', () => {
    const seed = deriveSeed(42n, 'sector', 7);
    expect(seedFromHex(seedToHex(seed))).toBe(seed);
  });
});

describe('Rng', () => {
  it('produces identical sequences for identical seeds', () => {
    const a = new Rng(99n);
    const b = new Rng(99n);
    for (let i = 0; i < 100; i++) expect(a.float()).toBe(b.float());
  });

  it('forked streams are independent of parent draw order', () => {
    const a = new Rng(7n);
    const b = new Rng(7n);
    b.float();
    b.float();
    expect(a.fork('child').float()).toBe(b.fork('child').float());
  });

  it('uniform floats stay in [0, 1) with sane mean', () => {
    const rng = new Rng(1n);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const v = rng.float();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 10000).toBeCloseTo(0.5, 1);
  });

  it('normal has approximately correct moments', () => {
    const rng = new Rng(2n);
    const n = 20000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = rng.normal(3, 2);
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(mean).toBeCloseTo(3, 1);
    expect(Math.sqrt(variance)).toBeCloseTo(2, 1);
  });
});

describe('power-law sampling', () => {
  it('respects bounds', () => {
    const rng = new Rng(3n);
    for (let i = 0; i < 1000; i++) {
      const v = powerLaw(rng, 2.3, 0.5, 150);
      expect(v).toBeGreaterThanOrEqual(0.5);
      expect(v).toBeLessThanOrEqual(150);
    }
  });

  it('steeper slopes concentrate samples at the low end', () => {
    const rng = new Rng(4n);
    const countLow = (alpha: number) => {
      let low = 0;
      for (let i = 0; i < 5000; i++) if (powerLaw(rng, alpha, 1, 100) < 10) low++;
      return low;
    };
    expect(countLow(2.5)).toBeGreaterThan(countLow(0.5));
  });

  it('broken power law stays within the overall range', () => {
    const rng = new Rng(5n);
    const segments = [
      { min: 0.01, max: 0.08, alpha: 0.3 },
      { min: 0.08, max: 0.5, alpha: 1.3 },
      { min: 0.5, max: 150, alpha: 2.3 },
    ];
    for (let i = 0; i < 2000; i++) {
      const v = brokenPowerLaw(rng, segments);
      expect(v).toBeGreaterThanOrEqual(0.01);
      expect(v).toBeLessThanOrEqual(150);
    }
  });
});
