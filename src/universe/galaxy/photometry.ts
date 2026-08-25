import { evolve } from '../star/evolution';
import { ageUnitOf, initialMassOf } from '../star/identity';
import type { StellarPhysical } from '../star/types';
import { populationFromUnit } from './population';
import { viewpointForSeed } from './sectors';

/**
 * Fast luminosity/temperature for a star seed: mass and age resolve
 * from the seed's identity bits through exactly the same maps as
 * generateStar — so a sky point and the full star a player travels to
 * always agree — while skipping metallicity, activity, companions, and
 * spectral color work. No stream draws at all.
 */
export function starPhotometry(seed: bigint): StellarPhysical {
  const { ageGyr } = populationFromUnit(ageUnitOf(seed), viewpointForSeed(seed));
  return evolve(initialMassOf(seed), ageGyr);
}
