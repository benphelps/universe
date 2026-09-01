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
 * Hβ luminosity of an ionization-bounded nebula, erg s⁻¹: every
 * ionizing photon is eventually answered by a recombination, and a
 * fixed share of those recombinations cascade through Hβ. So a
 * nebula's brightness is not a free parameter — it is its star's
 * ionizing output, converted.
 *
 * Q × (α_Hβ^eff / α_B) × hν(4861 Å), with α_Hβ^eff = 3.03e-14 cm³ s⁻¹
 * at 10⁴ K.
 */
export const HBETA_PER_IONIZING_PHOTON = (3.03e-14 / ALPHA_B) * 4.09e-12;

export function hydrogenBetaLuminosity(photonRate: number): number {
  return Math.max(0, photonRate) * HBETA_PER_IONIZING_PHOTON;
}

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

/** Sound speed of 10⁴ K ionized gas, the piston of the expansion:
 *  ~10 km/s, in the pc/Myr this file thinks in. */
const IONIZED_SOUND_SPEED_PC_PER_MYR = 10.2;

/**
 * The region's radius at its age, pc: Spitzer's D-type expansion.
 *
 * A front does not sit at its natal Strömgren radius — the ionized gas
 * is ten thousand kelvin against a cold cloud, overpressured by orders
 * of magnitude, and it shovels the neutral gas outward behind a shock:
 * R(t) = R_s (1 + 7 c_i t / 4 R_s)^{4/7}. The interior dilutes as it
 * grows — ionization balance holds n ∝ R^{-3/2}, so the same photon
 * budget fills the whole expanded volume exactly — which is why an
 * evolved region is a great glowing shell and not a pinprick. Winds
 * and supernovae push harder still past a few Myr; this is the floor.
 */
export function spitzerRadiusPc(stromgrenPc: number, ageMyr: number): number {
  if (stromgrenPc <= 0) return 0;
  if (ageMyr <= 0) return stromgrenPc;
  const driven = (7 * IONIZED_SOUND_SPEED_PC_PER_MYR * ageMyr) / (4 * stromgrenPc);
  return stromgrenPc * (1 + driven) ** (4 / 7);
}
