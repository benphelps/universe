import { describe, expect, it } from 'vitest';
import { spiralAzimuthSampler } from './spiralSampling';
import { armBoost, SMOOTH_MODEL } from './density';
import { getGalaxyParticles } from './particles';

describe('shared overview stellar sampling', () => {
  it('matches angular probabilities on interpolated radial rows', () => {
    const sample = spiralAzimuthSampler(), bins = 32, n = 32768;
    for (const radius of [2101, 5327, 8999, 14213, 22555]) {
      const expected = new Float64Array(bins), actual = new Float64Array(bins);
      for (let i = 0; i < n; i++) {
        expected[Math.floor(i * bins / n)] += armBoost(radius, (i + 0.5) * 2 * Math.PI / n) / n;
        const theta = sample(radius, (i + 0.5) / n);
        actual[Math.min(bins - 1, Math.floor(theta / (2 * Math.PI) * bins))] += 1 / n;
      }
      for (let i = 0; i < bins; i++) expect(Math.abs(actual[i] - expected[i])).toBeLessThan(0.0007);
    }
  });
  it('keeps the shared disc column and vertical scale without invented dust or line emitters', () => {
    const set = getGalaxyParticles();
    let radius = 0, absHeight = 0;
    for (let i = 0; i < set.count; i++) {
      radius += Math.hypot(set.positionsPc[i * 3], set.positionsPc[i * 3 + 1]);
      absHeight += Math.abs(set.positionsPc[i * 3 + 2]);
    }
    expect(radius / set.count / SMOOTH_MODEL.thinScaleLengthPc).toBeCloseTo(2, 1);
    expect(absHeight / set.count / SMOOTH_MODEL.thinScaleHeightPc).toBeCloseTo(1, 1);
    expect(set.count).toBe(8192);
  });
});
