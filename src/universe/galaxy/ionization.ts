import { PARSEC } from '../../core/physics/constants';

/**
 * Photoionization equilibrium: the scale on which a hot star's ionizing
 * output is used up by the gas around it. The nebula's structure comes
 * from marching this budget through the real density field; this is
 * the closed form the march has to agree with in a uniform medium.
 */

/** Case B recombination coefficient at 10⁴ K, cm³ s⁻¹. */
export const ALPHA_B = 2.59e-13;

/**
 * Strömgren radius, pc: where recombinations inside the sphere exactly
 * consume the source's ionizing photons. Case B — recombinations
 * straight to the ground state emit a photon that ionizes again
 * nearby, so they do not count against the budget.
 */
export function stromgrenRadiusPc(photonRate: number, hydrogenDensity: number): number {
  if (photonRate <= 0 || hydrogenDensity <= 0) return 0;
  const radiusCm =
    ((3 * photonRate) / (4 * Math.PI * ALPHA_B * hydrogenDensity * hydrogenDensity)) ** (1 / 3);
  return radiusCm / (PARSEC * 100);
}
