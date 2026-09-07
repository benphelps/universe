import { describe, expect, it } from 'vitest';
import { asteroidAxes, asteroidSurfaceColor } from './appearance';
import { createAsteroidField } from '../surface/asteroidField';
import type { Asteroid } from './types';

const body: Asteroid = {
  elements: { semiMajorAxis: 1e11, eccentricity: 0, inclination: 0, longitudeOfAscendingNode: 0,
    argumentOfPeriapsis: 0, meanAnomalyAtEpoch: 0, epoch: 0 },
  diameterKm: .8, taxonomy: 'C', albedo: .05, spinPeriodHours: 8, tumbling: false, rubblePile: true,
  shape: { elongation: .6, flattening: .5, contactBinary: false, noiseSeedHex: '123456789abcdef0' },
};

describe('shared asteroid appearance', () => {
  it('preserves datum volume and both major-axis ratios', () => {
    const [a, c, b] = asteroidAxes(body.shape);
    expect(a * b * c).toBeCloseTo(1, 12);
    expect(b / a).toBeCloseTo(.6, 12);
    expect(c / a).toBeCloseTo(.5, 12);
  });

  it('lets albedo own brightness without changing taxonomy chroma or terrain shape', () => {
    for (const taxonomy of ['C', 'S', 'M', 'D'] as const) {
      const dark = { ...body, taxonomy }, bright = { ...dark, albedo: .2 };
      const c = asteroidSurfaceColor(dark);
      expect(.2126 * c[0] + .7152 * c[1] + .0722 * c[2]).toBeCloseTo(.075, 12);
      expect(asteroidSurfaceColor({ ...dark, albedo: 0 })).toEqual([0, 0, 0]);
      const lo = createAsteroidField(dark), hi = createAsteroidField(bright);
      const dir = { x: 0, y: 0, z: 1 }, h = lo.heightAt(dir);
      expect(hi.heightAt(dir)).toBe(h);
      for (let i = 0; i < 3; i++) {
        expect(hi.colorAt(dir, h, 1)[i]).toBeCloseTo(4 * lo.colorAt(dir, h, 1)[i], 12);
      }
    }
  });
});
