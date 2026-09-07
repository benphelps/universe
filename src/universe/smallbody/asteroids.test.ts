import { describe, expect, it } from 'vitest';
import type { Belt } from '../system/types';
import { asteroidGravitySpinPeriodHours, buildAsteroid, instantiateBeltCell, SFD_SLOPE } from './asteroids';
import { Rng } from '../../core/rng/rng';
import { G } from '../../core/physics/constants';

const BELT: Belt = {
  kind: 'main',
  innerAu: 2.1,
  outerAu: 3.3,
  gaps: [{ semiMajorAxisAu: 2.5, widthAu: 0.05, resonance: '3:1' }],
  resonantPopulations: [],
  inclinationDispersionRad: 0.15,
};

describe('belt cell instantiation', () => {
  it('is deterministic per cell and independent across cells', () => {
    const a = instantiateBeltCell(42n, BELT, 7, 200);
    const b = instantiateBeltCell(42n, BELT, 7, 200);
    const c = instantiateBeltCell(42n, BELT, 8, 200);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('follows the size-frequency power law', () => {
    const asteroids: ReturnType<typeof instantiateBeltCell> = [];
    for (let cell = 0; cell < 30; cell++) {
      asteroids.push(...instantiateBeltCell(1n, BELT, cell, 300, 0.5));
    }
    const above = (d: number) => asteroids.filter((a) => a.diameterKm > d).length;
    // N(>1) / N(>10) should be ~10^SFD_SLOPE.
    const measured = Math.log10(above(1) / above(10));
    expect(measured).toBeGreaterThan(SFD_SLOPE - 0.5);
    expect(measured).toBeLessThan(SFD_SLOPE + 0.5);
  });

  it('respects the rubble-pile spin barrier and thins resonance gaps', () => {
    const asteroids = instantiateBeltCell(9n, BELT, 0, 3000);
    let inGap = 0;
    for (const asteroid of asteroids) {
      if (asteroid.rubblePile) {
        expect(asteroid.spinPeriodHours).toBeGreaterThanOrEqual(asteroidGravitySpinPeriodHours(asteroid));
      }
      const aAu = asteroid.elements.semiMajorAxis / 1.495978707e11;
      if (Math.abs(aAu - 2.5) < 0.025) inGap++;
    }
    // The gap keeps ~8% of the density of an equivalent full band.
    expect(inGap / asteroids.length).toBeLessThan(0.02);
  });

  it('shapes get lumpier at small sizes', () => {
    // Large bodies are SFD-rare, so draw them with a raised size floor.
    const small = instantiateBeltCell(5n, BELT, 0, 1500, 0.5).filter((a) => a.diameterKm < 5);
    const large = instantiateBeltCell(5n, BELT, 1, 300, 80);
    const meanElongation = (list: typeof large) =>
      list.reduce((s, a) => s + a.shape.elongation, 0) / list.length;
    expect(small.length).toBeGreaterThan(100);
    expect(meanElongation(small)).toBeLessThan(meanElongation(large));
  });
});


describe('gravity-dominated asteroid structure and rotation', () => {
  it('recovers the spherical shedding limit and density/axis scaling', () => {
    const body = buildAsteroid(new Rng(18n), BELT, 2.7, 1200);
    body.bulkDensityKgM3 = 1000;
    const sphere = Math.sqrt(3 * Math.PI / (G * 1000)) / 3600;
    expect(asteroidGravitySpinPeriodHours(body)).toBeCloseTo(sphere, 12);
    body.bulkDensityKgM3 = 4000;
    expect(asteroidGravitySpinPeriodHours(body)).toBeCloseTo(sphere / 2, 12);
    body.shape.elongation = .5;
    body.shape.flattening = .5;
    expect(asteroidGravitySpinPeriodHours(body)).toBeCloseTo(sphere, 12);
  });

  it('uses the funded density and does not assign rounded bodies a loose-pile interior or supercritical spin', () => {
    const belt = {...BELT, inventory: {initialMassEarth:1, massEarth:1, bulkDensityKgM3:1100,
      minDiameterKm:.1, maxDiameterKm:2000, slope:2.3, collisionLifetimeMyr:100}};
    let smallPiles = 0;
    for (let seed=0; seed<200; seed++) for (const diameter of [2, 400, 1320, 2000]) {
      const body = buildAsteroid(new Rng(BigInt(seed)), belt, 2.7, diameter);
      expect(body.bulkDensityKgM3).toBe(1100);
      if (diameter >= 300) expect(body.rubblePile).toBe(false);
      else if (body.rubblePile) smallPiles++;
      if (diameter >= 300 || body.rubblePile) {
        // Independent centrifugal / point-mass gravity ratio at the major axis.
        const axis = 1 / Math.cbrt(body.shape.elongation * body.shape.flattening);
        const omega = 2 * Math.PI / (body.spinPeriodHours * 3600);
        expect(omega ** 2 * axis ** 3 / (4 * Math.PI * G * 1100 / 3)).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
    expect(smallPiles).toBeGreaterThan(100);
  });
});
