import { Rng } from '../../core/rng/rng';
import { evolve } from '../star/evolution';
import { ageUnitOf, initialMassOf } from '../star/identity';
import { generateCompanionSpecs } from '../star/multiplicity';
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

/**
 * Unresolved companion light for a star seed: the same multiplicity
 * draws generateStar would make, each companion evolved at the system
 * age — a binary's sky glint carries the pair's combined light while
 * keeping the primary's color. Costs a few stream draws, so call it
 * only for stars that made the catalog.
 */
export function companionLuminosity(seed: bigint, localePc?: GalacticPosition): number {
  const { ageGyr } = populationFromUnit(ageUnitOf(seed), localePc ?? viewpointForSeed(seed));
  const specs = generateCompanionSpecs(new Rng(seed).fork('multiplicity'), initialMassOf(seed));
  let total = 0;
  for (const spec of specs) total += Math.max(0, evolve(spec.massSolar, ageGyr).luminosity);
  return total;
}
