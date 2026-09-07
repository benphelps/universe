import { expect, it } from 'vitest';
import { AU, G, SOLAR_LUMINOSITY, SOLAR_MASS } from '../../core/physics/constants';
import { mu as muOf } from '../../core/physics/units';
import type { OrbitalElements } from '../../core/math/orbit';
import type { Star } from '../star/types';
import type { StellarCompanion } from '../system/types';
import { dailyMeanInsolation, forcingPeriodSeconds, incidentBeams,
  instantaneousInsolation, orbitWorldPosition, stellarForcing, type PlanetForcing } from './illumination';
import type { PlanetRotation } from './types';

const orbit: OrbitalElements = { semiMajorAxis: AU, eccentricity: 0, inclination: 0,
  longitudeOfAscendingNode: 0, argumentOfPeriapsis: 0, meanAnomalyAtEpoch: 0, epoch: 0 };
const forcing: PlanetForcing = { sources: [{ luminositySolar: 1, path: [] }], origin: [],
  orbit: { elements: orbit, mu: muOf(G * SOLAR_MASS) } };
const year = forcingPeriodSeconds(forcing);
const rotation: PlanetRotation = { periodHours: 24, obliquityRad: 0, locked: false, spinOrbitResonance: null };


it('intercepts a beam over pi R² and recovers the exact rotation average', () => {
  const beams = incidentBeams(forcing, { ...rotation, obliquityRad: 0.7 }, year * 0.31);
  let mean = 0;
  const n = 256;
  for (let j = 0; j < n; j++) {
    const y = -1 + (j + 0.5) * 2 / n, r = Math.sqrt(1 - y * y);
    let daily = 0;
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * (i + 0.5) / n;
      daily += instantaneousInsolation({ x: r * Math.cos(a), y, z: r * Math.sin(a) }, beams) / n;
    }
    expect(Math.abs(daily - dailyMeanInsolation(y, beams)) / beams[0].fluxWm2).toBeLessThan(3e-5);
    mean += daily / n;
  }
  expect(Math.abs(mean * 4 / beams[0].fluxWm2 - 1)).toBeLessThan(5e-5);
});

it('time-weighted eccentric forcing agrees with the independent Kepler average', () => {
  for (const e of [0, 0.3, 0.8]) {
    const f = { ...forcing, orbit: { ...forcing.orbit, elements: { ...orbit, eccentricity: e } } };
    let sum = 0;
    for (let i = 0; i < 2048; i++) sum += incidentBeams(f, rotation, year * (i + 0.5) / 2048)[0].fluxWm2 / 2048;
    const expected = SOLAR_LUMINOSITY / (4 * Math.PI * AU ** 2 * Math.sqrt(1 - e * e));
    expect(Math.abs(sum / expected - 1)).toBeLessThan(1e-10);
  }
});

it('retains synchronous longitude, eccentric libration and 3:2 alternating noon', () => {
  const sync = { ...rotation, locked: true, periodHours: year / 3600 };
  const initial = incidentBeams(forcing, sync, 0)[0].direction;
  for (const phase of [0.1, 0.3, 0.7, 1]) {
    const d = incidentBeams(forcing, sync, phase * year)[0].direction;
    expect(Math.hypot(d.x - initial.x, d.y - initial.y, d.z - initial.z)).toBeLessThan(1e-12);
  }
  const eccentric = { ...forcing, orbit: { ...forcing.orbit, elements: { ...orbit, eccentricity: 0.3 } } };
  expect(Math.abs(incidentBeams(eccentric, sync, year * 0.25)[0].direction.z)).toBeGreaterThan(0.3);
  const resonant = { ...sync, periodHours: year / 3600 / 1.5 };
  expect(incidentBeams(forcing, resonant, year)[0].direction.x).toBeCloseTo(-initial.x, 12);
  expect(incidentBeams(forcing, resonant, year * 2)[0].direction.x).toBeCloseTo(initial.x, 12);
});

it('does not force the poles dark at high obliquity and preserves the moon solar day', () => {
  const tilted = { ...rotation, obliquityRad: Math.PI / 2 };
  const a = incidentBeams(forcing, tilted, 0), b = incidentBeams(forcing, tilted, year / 2);
  expect(a[0].direction.y).toBeCloseTo(-1, 12);
  expect(b[0].direction.y).toBeCloseTo(1, 12);
  expect(dailyMeanInsolation(1, b)).toBeCloseTo(b[0].fluxWm2, 8);
  const moon = { ...rotation, periodHours: 27.3 * 24, locked: true, lockTarget: 'planet' as const };
  const solarDay = 1 / (1 / (moon.periodHours * 3600) - 1 / year);
  expect(incidentBeams(forcing, moon, solarDay)[0].direction.x).toBeCloseTo(-1, 12);
  expect(incidentBeams(forcing, moon, solarDay / 2)[0].direction.x).toBeCloseTo(1, 12);
});

it('keeps circumbinary planets at the barycentre and sums each source independently', () => {
  const star = { mass: 1, luminosity: 1 } as Star;
  const companion = { star: { mass: 0.5, luminosity: 0.25 }, elements: { ...orbit, semiMajorAxis: 0.1 * AU } } as StellarCompanion;
  const layout = stellarForcing(star, [companion], 'p-type');
  expect(layout.origin).toEqual([]);
  const [a, b] = layout.sources.map(s => orbitWorldPosition(s.path, 0));
  expect(a.x + b.x * 0.5).toBeCloseTo(0, 5);
  const f = { ...forcing, ...layout };
  const beams = incidentBeams(f, rotation, 0);
  expect(beams).toHaveLength(2);
  const expected = SOLAR_LUMINOSITY / (4 * Math.PI) * (1 / (AU - a.x) ** 2 + 0.25 / (AU - b.x) ** 2);
  expect(instantaneousInsolation({ x: -1, y: 0, z: 0 }, beams) / expected).toBeCloseTo(1, 12);
});
