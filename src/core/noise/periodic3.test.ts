import { describe, expect, it } from 'vitest';
import { createPeriodicPerlin3 } from './periodic3';

describe('periodic gradient noise', () => {
  it('repeats exactly at its period on every axis', () => {
    const period = 16;
    const noise = createPeriodicPerlin3(42n, period);
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * period;
      const y = Math.random() * period;
      const z = Math.random() * period;
      const here = noise(x, y, z);
      expect(noise(x + period, y, z)).toBeCloseTo(here, 12);
      expect(noise(x, y + period, z)).toBeCloseTo(here, 12);
      expect(noise(x, y, z + period)).toBeCloseTo(here, 12);
      expect(noise(x + 3 * period, y - 2 * period, z + period)).toBeCloseTo(here, 12);
    }
  });

  it('is deterministic in the seed and differs across seeds', () => {
    const a = createPeriodicPerlin3(7n, 16);
    const b = createPeriodicPerlin3(7n, 16);
    const c = createPeriodicPerlin3(8n, 16);
    let diverged = false;
    for (let i = 0; i < 50; i++) {
      const x = Math.random() * 16;
      const y = Math.random() * 16;
      const z = Math.random() * 16;
      expect(b(x, y, z)).toBe(a(x, y, z));
      if (Math.abs(c(x, y, z) - a(x, y, z)) > 1e-6) diverged = true;
    }
    expect(diverged).toBe(true);
  });

  it('matches the simplex spread it stands in for', () => {
    const noise = createPeriodicPerlin3(11n, 16);
    let sum = 0;
    let sq = 0;
    let peak = 0;
    const n = 100000;
    for (let i = 0; i < n; i++) {
      const v = noise(Math.random() * 16, Math.random() * 16, Math.random() * 16);
      sum += v;
      sq += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    const mean = sum / n;
    const std = Math.sqrt(sq / n - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    // createSimplex3 measures std ≈ 0.43; the scale constant pins this.
    expect(std).toBeGreaterThan(0.36);
    expect(std).toBeLessThan(0.5);
    expect(peak).toBeLessThan(1.6);
  });
});
