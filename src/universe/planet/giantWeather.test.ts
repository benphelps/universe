import { expect, it } from 'vitest';
import { activeStorms, deriveCirculation } from './circulation';
import { advectedStormLongitude, giantChurnOffset, giantWeatherPhases, giantWeatherLifetime, wrapWeatherAngle } from './giantWeather';
import { giantFixture } from './__fixtures__/giants';

it('keeps active parcel identity continuous across regeneration and old clock folds', () => {
  for (const t of [-1024, -512, -32, -16, 0, 16, 32, 512, 1024, 1e8]) {
    const a = giantWeatherPhases(t - 1e-5), b = giantWeatherPhases(t + 1e-5);
    if (a.weightA > .5) {
      expect(a.seedA).toEqual(b.seedA);
      expect(Math.abs(a.ageA - b.ageA)).toBeLessThan(.001);
    } else {
      expect(a.seedB).toEqual(b.seedB);
      expect(Math.abs(a.ageB - b.ageB)).toBeLessThan(.001);
    }
    for (const component of [0, 1, 2]) expect(Math.abs(giantChurnOffset(t - 1e-5, .4)[component]
      - giantChurnOffset(t + 1e-5, .4)[component])).toBeLessThan(.001);
  }
  expect(giantWeatherPhases(100).seedA).not.toEqual(giantWeatherPhases(612).seedA);
});

it('advects a storm with the same characteristic as a backtraced cloud parcel', () => {
  const initial = .73, drift = .17;
  for (const t of [-100, 0, 2, 100, 1e9]) {
    const storm = advectedStormLongitude(initial, drift, t);
    expect(Math.abs(storm)).toBeLessThanOrEqual(Math.PI);
    expect(wrapWeatherAngle(storm + wrapWeatherAngle(drift * t))).toBeCloseTo(initial, 6);
  }
});

it('retains storm texture identity when another active slot is removed', () => {
  const c = deriveCirculation(giantFixture());
  const first = c.storms[0];
  const second = { ...first, seed: first.seed + 99 };
  c.storms = [first, second];
  const t = first.phaseDays + first.lifeDays / 2;
  const withBoth = activeStorms(c, t);
  expect(withBoth).toHaveLength(2);
  c.storms = [second];
  expect(activeStorms(c, t)[0]).toEqual(withBoth[1]);
});


it('renews fast jets before differential advection winds clouds into threads', () => {
  for (const jump of [.01, .1, 1, 10]) {
    const bands = [{ driftRadPerDay: -jump / 2 }, { driftRadPerDay: jump / 2 }];
    const lifetime = giantWeatherLifetime(bands);
    const maxShear = .75 * jump / .04;
    for (const epoch of [-1e8, -32, 0, 100, 1e8]) {
      for (let i = 0; i <= 32; i++) {
        const phases = giantWeatherPhases(epoch + lifetime * i / 32, lifetime);
        expect(Math.max(Math.abs(phases.ageA), Math.abs(phases.ageB)) * maxShear).toBeLessThanOrEqual(2.000001);
        expect(phases.weightA + phases.weightB).toBeCloseTo(1);
      }
    }
    const boundary = lifetime * 8;
    const before = giantWeatherPhases(boundary - 1e-7, lifetime);
    const after = giantWeatherPhases(boundary + 1e-7, lifetime);
    expect(before.seedB).toEqual(after.seedB);
    expect(after.ageB - before.ageB).toBeCloseTo(2e-7);
  }
  expect(giantWeatherLifetime([{ driftRadPerDay: 1 }, { driftRadPerDay: 1 }])).toBe(32);
});
