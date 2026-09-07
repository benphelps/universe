import { expect, it } from 'vitest';
import { AU, G, SOLAR_MASS, SIGMA_SB } from '../../core/physics/constants';
import { mu as muOf } from '../../core/physics/units';
import { annualSurfaceTemperatures, buildAnnualInsolation, surfaceTemperatureAt } from './surfaceClimate';
import { forcingPeriodSeconds, type PlanetForcing } from './illumination';
import type { PlanetRotation } from './types';

const forcing: PlanetForcing = { origin: [], sources: [{ luminositySolar: 1, path: [] }], orbit: {
  mu: muOf(G * SOLAR_MASS), elements: { semiMajorAxis: AU, eccentricity: 0.1, inclination: 0,
    longitudeOfAscendingNode: 0, argumentOfPeriapsis: 0, meanAnomalyAtEpoch: 0.4, epoch: 0 } } };
const rotation: PlanetRotation = { periodHours: 24, obliquityRad: 0, locked: false, spinOrbitResonance: null };

it('separates the physical annual energy budget from finite angular quadrature', () => {
  const light = buildAnnualInsolation(forcing, rotation);
  for (const p of [0, 0.01, 1, 100]) for (const heat of [0, 0.09, 100]) {
    const field = annualSurfaceTemperatures(light, 0.3, 0.8, heat, p);
    expect(field.expectedMeanOutgoingWm2! / (light.meanFluxWm2 * 0.7 + heat)).toBeCloseTo(1, 12);
    expect(Math.abs(field.meanOutgoingWm2 / field.expectedMeanOutgoingWm2! - 1)).toBeLessThan(.01);
    expect(field.meanK).toBeGreaterThan(0);
    // Jensen's bound uses the same finite angular samples as meanK.
    // Physical sphere-integrated power is tracked separately; do not
    // rescale illumination to conceal that quadrature difference.
    expect(field.meanK).toBeLessThanOrEqual((field.meanOutgoingWm2 * 1.6 / SIGMA_SB) ** 0.25 * (1 + 1e-12));
  }
});

it('gives high-obliquity poles more annual energy than the equator', () => {
  const upright = annualSurfaceTemperatures(buildAnnualInsolation(forcing, rotation), 0.3, 0, 0, 0.1);
  const sideways = annualSurfaceTemperatures(buildAnnualInsolation(forcing, { ...rotation, obliquityRad: Math.PI / 2 }), 0.3, 0, 0, 0.1);
  const pole = { x: 0, y: 1, z: 0 }, equator = { x: 1, y: 0, z: 0 };
  expect(surfaceTemperatureAt(upright, equator)).toBeGreaterThan(surfaceTemperatureAt(upright, pole) + 40);
  expect(surfaceTemperatureAt(sideways, pole)).toBeGreaterThan(surfaceTemperatureAt(sideways, equator) + 10);
});

it('retains a synchronous hot side without imposing one on a planet-locked moon', () => {
  const f = { ...forcing, orbit: { ...forcing.orbit, elements: { ...forcing.orbit.elements, eccentricity: 0, meanAnomalyAtEpoch: 0 } } };
  const sync = { ...rotation, periodHours: forcingPeriodSeconds(f) / 3600, locked: true };
  const field = annualSurfaceTemperatures(buildAnnualInsolation(f, sync), 0.3, 0, 0.1, 0.01);
  expect(field.mode).toBe('spin-resolved');
  expect(surfaceTemperatureAt(field, { x: -1, y: 0, z: 0 })).toBeGreaterThan(surfaceTemperatureAt(field, { x: 1, y: 0, z: 0 }) + 200);
  const moon = buildAnnualInsolation(f, { ...sync, lockTarget: 'planet' });
  expect(moon.longitudeCount).toBe(1);
});

it('has convergent annual power/temperature and no polar or longitude discontinuity', () => {
  const r = { ...rotation, locked: true, periodHours: forcingPeriodSeconds(forcing) / 3600 };
  const a = annualSurfaceTemperatures(buildAnnualInsolation(forcing, r, 12, 96), 0.3, 0.5, 0.1, 1);
  const b = annualSurfaceTemperatures(buildAnnualInsolation(forcing, r, 24, 192), 0.3, 0.5, 0.1, 1);
  expect(Math.abs(a.meanK - b.meanK)).toBeLessThan(0.5);
  expect(Math.abs(b.meanOutgoingWm2-b.expectedMeanOutgoingWm2!)).toBeLessThan(Math.abs(a.meanOutgoingWm2-a.expectedMeanOutgoingWm2!));
  const seam1 = surfaceTemperatureAt(a, { x: 1, y: 0, z: -1e-9 });
  const seam2 = surfaceTemperatureAt(a, { x: 1, y: 0, z: 1e-9 });
  expect(Math.abs(seam1 - seam2)).toBeLessThan(1e-6);
  expect(surfaceTemperatureAt(a, { x: 1e-12, y: 1, z: 0 })).toBeCloseTo(surfaceTemperatureAt(a, { x: -1e-12, y: 1, z: 0 }), 8);
});

it('preserves the independent circular synchronous temperature at the horizon, poles and both hemispheres', () => {
  const f = { ...forcing, orbit: { ...forcing.orbit, elements: { ...forcing.orbit.elements, eccentricity: 0, meanAnomalyAtEpoch: 0 } } };
  const r = { ...rotation, periodHours: forcingPeriodSeconds(f) / 3600, locked: true };
  const flux = 4 * buildAnnualInsolation(f, r).meanFluxWm2, p = 1e-5, albedo = 0.3, heat = 0.1, tau = 0.8;
  for (const ny of [4, 12, 24]) {
    const field = annualSurfaceTemperatures(buildAnnualInsolation(f, r, ny), albedo, tau, heat, p);
    for (const x of [-1, -0.001, 0, 0.001, 1]) for (const poleward of [false, true]) {
      const a = Math.sqrt(1 - x * x), dir = { x, y: poleward ? a : 0, z: poleward ? 0 : a };
      const power = (1-albedo)*flux*(Math.exp(-p)*Math.max(0,-x)-Math.expm1(-p)/4)+heat;
      expect(surfaceTemperatureAt(field,dir)).toBeCloseTo((power*(1+.75*tau)/SIGMA_SB)**.25,6);
    }
  }
});

it('uses actual polar annual insolation for rotating worlds, including the zero-tilt dark pole', () => {
  for (const tilt of [0, 0.4, Math.PI/2, 2.5]) {
    const light = buildAnnualInsolation(forcing,{...rotation,obliquityRad:tilt});
    const field = annualSurfaceTemperatures(light, .3, .8, .09, .1);
    const polarFlux = 4*light.meanFluxWm2*Math.abs(Math.sin(tilt))/Math.PI;
    const power = .7*(Math.exp(-.1)*polarFlux-Math.expm1(-.1)*light.meanFluxWm2)+.09;
    for(const y of [-1,1])expect(surfaceTemperatureAt(field,{x:0,y,z:0})).toBeCloseTo((power*1.6/SIGMA_SB)**.25,8);
  }
});

it('the fast central-source table agrees with finer orbital/latitude quadrature', () => {
  for (const tilt of [0, 0.4, 0.9, Math.PI / 2, 2.5, Math.PI]) {
    const f = { ...forcing, orbit: { ...forcing.orbit, elements: { ...forcing.orbit.elements,
      inclination: 0.3, longitudeOfAscendingNode: 1.1, eccentricity: 0.6 } } };
    const r = { ...rotation, obliquityRad: tilt };
    const a = annualSurfaceTemperatures(buildAnnualInsolation(f, r), 0.3, 0.5, 0.1, 1);
    const b = annualSurfaceTemperatures(buildAnnualInsolation(f, r, 48, 768), 0.3, 0.5, 0.1, 1);
    expect(Math.abs(a.expectedMeanOutgoingWm2! / b.expectedMeanOutgoingWm2! - 1)).toBeLessThan(1e-10);
    expect(Math.abs(a.meanOutgoingWm2 / a.expectedMeanOutgoingWm2! - 1)).toBeLessThan(.004);
    expect(Math.abs(a.meanK - b.meanK)).toBeLessThan(0.3);
  }
});
