import { stellarBandRgb, type StellarResponse } from '../../core/color/stellarLight';
import type { LinearRgb } from '../../core/color/srgb';
import { deriveSeed } from '../../core/rng/hash';
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
 * age. This bolometric helper is retained for physical comparisons;
 * rendered sources use unresolvedStarLight and each component spectrum.
 */
export function companionLuminosity(seed: bigint, localePc?: GalacticPosition): number {
  const { ageGyr } = populationFromUnit(ageUnitOf(seed), localePc ?? viewpointForSeed(seed));
  const specs = generateCompanionSpecs(new Rng(seed).fork('multiplicity'), initialMassOf(seed));
  let total = 0;
  for (const spec of specs) total += Math.max(0, evolve(spec.massSolar, ageGyr).luminosity);
  return total;
}

/** Combined source power before attenuation or display. Companions use
 * their own evolved temperatures; a remnant primary may have a luminous
 * companion. The seed recovers component luminosities and temperatures
 * for future filter responses. */
export function unresolvedStarLight(
  seed: bigint,
  localePc?: GalacticPosition,
  primary?: StellarPhysical,
  response?: StellarResponse,
): { primary: StellarPhysical; bolometric: number; rgb: LinearRgb } {
  const mass = initialMassOf(seed);
  const { ageGyr } = populationFromUnit(ageUnitOf(seed), localePc ?? viewpointForSeed(seed));
  primary ??= evolve(mass, ageGyr);
  const rgb = stellarBandRgb(primary.luminosity, primary.tEff, response);
  let bolometric = Math.max(0, primary.luminosity);
  // Fork directly: the unused parent stream need not initialize a PRNG.
  const specs = generateCompanionSpecs(new Rng(deriveSeed(seed, 'multiplicity')), mass);
  for (const spec of specs) {
    const star = evolve(spec.massSolar, ageGyr);
    const light = stellarBandRgb(star.luminosity, star.tEff, response);
    bolometric += Math.max(0, star.luminosity);
    for (let c = 0; c < 3; c++) rgb[c] += light[c];
  }
  return { primary, bolometric, rgb };
}
