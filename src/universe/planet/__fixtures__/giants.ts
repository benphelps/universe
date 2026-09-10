import { AU, G, SOLAR_MASS } from '../../../core/physics/constants';
import { mu } from '../../../core/physics/units';
import { generateStar } from '../../star/generate';
import { computeZones } from '../../system/zones';
import type { PlanetClass } from '../../system/types';
import { characterizePlanet } from '../characterize';

export const GIANT_REFERENCES = [
  { name: 'Jupiter', seed: 14n, mass: 318, orbit: 5.2, type: 'gas-giant' },
  { name: 'Saturn', seed: 17n, mass: 95, orbit: 9.5, type: 'gas-giant' },
  { name: 'Uranus', seed: 15n, mass: 14.5, orbit: 19.2, type: 'ice-giant' },
  { name: 'Neptune', seed: 18n, mass: 17.1, orbit: 30.1, type: 'ice-giant' },
  { name: 'Hot Jupiter', seed: 16n, mass: 400, orbit: .05, type: 'gas-giant' },
] as const;

/** Solar-system-like mass/orbit inputs; spins, compositions and weather are
 * generated. These are calibration probes, not claims to reproduce each planet. */
export function giantFixture({ seed = 14n, mass = 318, orbit = 5.2, age = 4.6,
  type = 'gas-giant' as PlanetClass } = {}) {
  const star = generateStar(1n, { massInitial: 1, ageGyr: age, feH: 0, withCompanions: false });
  return characterizePlanet(seed, type, mass, {
    semiMajorAxis: orbit * AU, eccentricity: .02, inclination: 0,
    longitudeOfAscendingNode: 0, argumentOfPeriapsis: 0, meanAnomalyAtEpoch: 0, epoch: 0,
  }, { star, centralLuminosity: 1, mu: mu(G * SOLAR_MASS),
    zones: computeZones(1, star.tEff, age, 1) });
}
