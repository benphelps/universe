import { describe, expect, it } from 'vitest';
import { blackbodyOpticalRgb, opticalLuminosityFraction, opticalRgbInterpolator, rgbLuminance } from './optical';

describe('optical power and colour', () => {
  it('preserves independently integrated visible power, not bolometric or peak-normalized brightness', () => {
    // Independent dimensionless Planck integral, 15/π⁴ ∫x³/(exp(x)-1) dx.
    for (const [temperature, fraction] of [[5772, 0.46496980417802714], [10000, 0.4045955314735442], [40000, 0.02579373943872987]]) {
      expect(Math.abs(rgbLuminance(blackbodyOpticalRgb(temperature)) / fraction - 1)).toBeLessThan(1e-4);
    }
    expect(blackbodyOpticalRgb(0)).toEqual([0, 0, 0]);
    const cold = blackbodyOpticalRgb(2500), hot = blackbodyOpticalRgb(40000);
    expect(cold[0]).toBeGreaterThan(cold[2]);
    expect(hot[2]).toBeGreaterThan(hot[0]);
  });

  it('bounds interpolation error over dwarfs, giants and hot remnants without temperature clamping', () => {
    const lookup = opticalRgbInterpolator();
    let maximumRelative = 0, maximumAbsolute = 0;
    for (let i = 0; i <= 6000; i++) {
      const temperature = 100 * (1e5 ** (i / 6000));
      const exact = blackbodyOpticalRgb(temperature), sampled = lookup(temperature);
      for (let c = 0; c < 3; c++) {
        maximumAbsolute = Math.max(maximumAbsolute, Math.abs(sampled[c] - exact[c]));
        if (exact[c] > 1e-5) maximumRelative = Math.max(maximumRelative, Math.abs(sampled[c] / exact[c] - 1));
        expect(Number.isFinite(sampled[c]) && sampled[c] >= 0).toBe(true);
      }
    }
    expect(maximumRelative).toBeLessThan(5e-4);
    expect(maximumAbsolute).toBeLessThan(1e-7);
    expect(rgbLuminance(lookup(1e6))).toBeLessThan(opticalLuminosityFraction(50000) / 1000);
  });
});
