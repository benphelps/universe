import { describe, expect, it } from 'vitest';
import { blackbodyChromaticity, blackbodyLinearRgb, temperatureToLutCoord } from './blackbody';

describe('blackbodyChromaticity', () => {
  it('solar temperature lands on the Planckian locus near white', () => {
    const { x, y } = blackbodyChromaticity(5772);
    expect(x).toBeCloseTo(0.3267, 1.5);
    expect(y).toBeCloseTo(0.3335, 1.5);
    expect(Math.abs(x - 0.3267)).toBeLessThan(0.012);
    expect(Math.abs(y - 0.3335)).toBeLessThan(0.012);
  });

  it('x decreases monotonically with temperature (red → blue)', () => {
    let prev = Infinity;
    for (const t of [2500, 3500, 5000, 7000, 10000, 20000, 40000]) {
      const { x } = blackbodyChromaticity(t);
      expect(x).toBeLessThan(prev);
      prev = x;
    }
  });
});

describe('blackbodyLinearRgb', () => {
  it('cool stars are red-dominant, hot stars blue-dominant', () => {
    const cool = blackbodyLinearRgb(3000);
    expect(cool[0]).toBeGreaterThan(cool[2]);
    const hot = blackbodyLinearRgb(25000);
    expect(hot[2]).toBeGreaterThan(hot[0]);
  });

  it('never produces negative channels or NaN across the full range', () => {
    for (const t of [1000, 2000, 5772, 15000, 50000, 200000]) {
      const rgb = blackbodyLinearRgb(t);
      for (const c of rgb) {
        expect(Number.isFinite(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it('green never dominates both other channels', () => {
    for (let t = 1500; t <= 60000; t += 500) {
      const [r, g, b] = blackbodyLinearRgb(t);
      expect(g > r && g > b * 1.05).toBe(false);
    }
  });
});

describe('temperatureToLutCoord', () => {
  it('maps hot to 0-end and cool to 1-end, clamped', () => {
    expect(temperatureToLutCoord(60000)).toBe(0);
    expect(temperatureToLutCoord(1000)).toBe(1);
    const mid = temperatureToLutCoord(5772);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(temperatureToLutCoord(3000)).toBeGreaterThan(mid);
  });
});
