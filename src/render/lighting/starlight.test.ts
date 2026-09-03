import { describe, expect, it } from 'vitest';
import { AU } from '../../core/physics/constants';
import type { Star } from '../../universe/star/types';
import {
  adapted,
  extendedSkyVisibility,
  instellation,
  pointStarVisibility,
  starlight,
} from './starlight';

const AU_KM = AU / 1000;

const sunlike = {
  luminosity: 1,
  linearRgb: [1, 0.95, 0.9],
  variability: null,
  activity: { flareRatePerDay: 0 },
  seedHex: '00',
} as unknown as Star;

describe('instellation', () => {
  it('is Earth sunlight at one AU around one solar luminosity', () => {
    expect(instellation(1, AU_KM)).toBeCloseTo(1, 9);
  });

  it('falls with the square of distance and rises with luminosity', () => {
    expect(instellation(1, 2 * AU_KM)).toBeCloseTo(0.25, 9);
    expect(instellation(4, 2 * AU_KM)).toBeCloseTo(1, 9);
  });
});

describe('starlight', () => {
  it('displays sunlight at one AU as the star hue itself', () => {
    expect(starlight(sunlike, AU_KM, 0)).toEqual([1, 0.95, 0.9]);
  });

  it('dims a far world on the adapted scale, not the linear one', () => {
    const [r] = starlight(sunlike, 30 * AU_KM, 0);
    expect(r).toBeCloseTo(adapted(1 / 900), 6);
    expect(r).toBeGreaterThan(1 / 900);
    expect(r).toBeLessThan(1);
  });

  it('a Y dwarf lights its close world dim, not bright', () => {
    const dwarf = { ...sunlike, luminosity: 2.26e-7, linearRgb: [1, 0.2, 0.02] } as unknown as Star;
    const [r] = starlight(dwarf, 0.164 * AU_KM, 0);
    expect(r).toBeLessThan(0.12);
    expect(r).toBeGreaterThan(0.05);
  });

  it('shows a pulsation at full contrast on top of the adapted level', () => {
    const cepheid = {
      ...sunlike,
      variability: { type: 'cepheid', periodDays: 10, amplitude: 0.2 },
    } as unknown as Star;
    const [peak] = starlight(cepheid, AU_KM, 2.5);
    const [trough] = starlight(cepheid, AU_KM, 7.5);
    expect(peak).toBeCloseTo(1.2, 6);
    expect(trough).toBeCloseTo(0.8, 6);
  });
});

describe('night-sky visibility', () => {
  it('reveals point stars before diffuse galactic light', () => {
    const twilight = 1e-3;
    expect(pointStarVisibility(twilight)).toBeGreaterThan(0.6);
    expect(extendedSkyVisibility(twilight)).toBeLessThan(0.05);
  });

  it('suppresses stars under a bright daytime sky', () => {
    expect(pointStarVisibility(0.03)).toBe(0);
    expect(extendedSkyVisibility(0.03)).toBe(0);
  });

  it('gives diffuse light a continuous, finite fade with no culling jump', () => {
    const midpoint = Math.sqrt(2e-7 * 3e-3);
    expect(extendedSkyVisibility(2e-7)).toBe(1);
    expect(extendedSkyVisibility(midpoint)).toBeCloseTo(0.5, 8);
    expect(extendedSkyVisibility(3e-3)).toBe(0);
  });

  it('is monotonic and never leaves diffuse structure after the point field', () => {
    const radiances = [0.03, 3e-3, 1e-3, 1e-4, 1e-5, 1e-7, 0];
    const point = radiances.map(pointStarVisibility);
    const extended = radiances.map(extendedSkyVisibility);
    for (let i = 1; i < radiances.length; i++) {
      expect(point[i]).toBeGreaterThanOrEqual(point[i - 1]);
      expect(extended[i]).toBeGreaterThanOrEqual(extended[i - 1]);
    }
    for (let i = 0; i < radiances.length; i++) {
      expect(point[i]).toBeGreaterThanOrEqual(extended[i]);
    }
    expect(point.at(-1)).toBe(1);
    expect(extended.at(-1)).toBe(1);
  });
});
