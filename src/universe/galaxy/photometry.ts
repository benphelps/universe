import { evolve } from '../star/evolution';
import { ageUnitOf, initialMassOf } from '../star/identity';
import type { StellarPhysical } from '../star/types';
import type { GalacticPosition } from './density';
import { populationFromUnit } from './population';
import { viewpointForSeed } from './sectors';

/**
 * Fast luminosity/temperature for a star seed: mass and age resolve
 * from the seed's identity bits through exactly the same maps as
 * generateStar — so a sky point and the full star a player travels to
 * always agree — while skipping metallicity, activity, companions, and
 * spectral color work. Catalog stars pass their true galactic position
 * (the population mix is local); bare seeds fall back to the
 * seed-derived locale. No stream draws at all.
 */
export function starPhotometry(seed: bigint, localePc?: GalacticPosition): StellarPhysical {
  const { ageGyr } = populationFromUnit(ageUnitOf(seed), localePc ?? viewpointForSeed(seed));
  return evolve(initialMassOf(seed), ageGyr);
}
