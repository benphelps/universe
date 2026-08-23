import { Rng } from '../../core/rng/rng';
import { evolve } from '../star/evolution';
import { sampleInitialMass } from '../star/imf';
import type { StellarPhysical } from '../star/types';

/**
 * Fast luminosity/temperature for a star seed, drawing age, metallicity,
 * and mass through exactly the same stream as generateStar — so a sky
 * point and the full star a player travels to always agree — while
 * skipping activity, companions, and spectral color work.
 */
export function starPhotometry(seed: bigint): StellarPhysical {
  const rng = new Rng(seed);
  const ageGyr = rng.range(0.1, 10);
  rng.normal(0, 0.2);
  const massInitial = sampleInitialMass(rng.fork('imf'));
  return evolve(massInitial, ageGyr);
}
