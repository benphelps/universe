import { giantContraction } from './giantEvolution';
import { EARTH_MASS, EARTH_RADIUS, G } from '../../core/physics/constants';
import type { Rng } from '../../core/rng/rng';
import type { PlanetClass } from '../system/types';
import type { PlanetBulk } from './types';

const EARTH_DENSITY_GCC = 5.51;

/**
 * Mass–radius by composition (Zeng-style power laws for solids, nearly
 * flat degenerate radii for giants, irradiation inflation for hot ones).
 */
export function computeBulk(
  rng: Rng,
  massEarth: number,
  planetClass: PlanetClass,
  equilibriumK: number,
  rotationPeriodHours: number,
  ironCoreFraction: number,
  ageGyr = 4.6,
): PlanetBulk {
  let radiusEarth: number;
  switch (planetClass) {
    case 'gas-giant': {
      // Join the low-mass envelope and degenerate branches smoothly. The
      // previous exponent switch jumped by 5.4% at 150 Earth masses.
      const transition = Math.max(0, Math.min(1, (massEarth - 100) / 120));
      const weight = transition * transition * (3 - 2 * transition);
      radiusEarth = 11.2 * (massEarth / 318) ** (.13 + (.06 - .13) * weight);
      if (equilibriumK > 1000) {
        radiusEarth *= Math.min(1.4, 1 + 0.4 * ((equilibriumK - 1000) / 1000));
      }
      break;
    }
    case 'ice-giant':
      radiusEarth = 3.9 * (massEarth / 17) ** 0.35;
      break;
    case 'mini-neptune': {
      // Rocky core plus a few-percent H/He envelope; hotter envelopes puff.
      const puff = 1 + Math.min(0.5, Math.max(0, (equilibriumK - 500) / 2000));
      radiusEarth = 2.0 * (massEarth / 5) ** 0.35 * rng.range(0.85, 1.15) * puff;
      break;
    }
    default: {
      // Iron-rich worlds are compact, water-rich ones inflated.
      const ironFactor = 1 - 0.35 * (ironCoreFraction - 0.33);
      radiusEarth = massEarth ** 0.27 * ironFactor * rng.range(0.97, 1.03);
    }
  }

  if (planetClass === 'gas-giant' || planetClass === 'ice-giant') {
    radiusEarth *= giantContraction(ageGyr);
  }

  const massKg = massEarth * EARTH_MASS;
  const radiusM = radiusEarth * EARTH_RADIUS;
  const gravityMs2 = (G * massKg) / radiusM ** 2;
  const omega = (2 * Math.PI) / (rotationPeriodHours * 3600);
  return {
    massEarth,
    radiusEarth,
    densityGcc: EARTH_DENSITY_GCC * (massEarth / radiusEarth ** 3),
    gravityMs2,
    escapeVelocityKms: Math.sqrt((2 * G * massKg) / radiusM) / 1000,
    // Centrally condensed bodies flatten less than the uniform-density (5/4)q.
    oblateness: Math.min(0.35, 0.7 * ((omega ** 2 * radiusM ** 3) / (G * massKg))),
  };
}
