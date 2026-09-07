import { describe, expect, it } from 'vitest';
import { surfaceRadiusSampler } from './radialSampling';

describe('surface-density radial sampling', () => {
  it('distributes a uniform disc by area, not equally among radii', () => {
    const radius = surfaceRadiusSampler(() => 1, 10);
    for (const fraction of [0.01, 0.1, 0.25, 0.5, 0.9]) {
      expect(radius(fraction)).toBeCloseTo(10 * Math.sqrt(fraction), 4);
    }
    expect(radius(0)).toBe(0);
    expect(radius(1)).toBe(10);
  });

  it('recovers an exponential disc with half-mass radius 1.678 scale lengths', () => {
    const scale = 2600;
    const radius = surfaceRadiusSampler(r => Math.exp(-r / scale), 20 * scale, 4096);
    expect(radius(0.5) / scale).toBeCloseTo(1.67834699, 5);
    const count = 10000;
    let mean = 0;
    for (let i = 0; i < count; i++) mean += radius((i + 0.5) / count) / count;
    expect(mean / scale).toBeCloseTo(2, 3);
  });

  it('is invariant to surface-density normalization', () => {
    const a = surfaceRadiusSampler(r => Math.exp(-r), 12);
    const b = surfaceRadiusSampler(r => 1e8 * Math.exp(-r), 12);
    for (const u of [0.001, 0.2, 0.5, 0.99]) expect(a(u)).toBeCloseTo(b(u), 12);
  });
});
