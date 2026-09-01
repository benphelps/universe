import { planckRadiance } from '../../core/color/planck';
import { C_LIGHT, H_PLANCK, SOLAR_RADIUS } from '../../core/physics/constants';

/** The Lyman limit, nm: 13.6 eV, the longest wavelength that still
 *  ionizes hydrogen from the ground state. */
export const LYMAN_LIMIT_NM = 91.176;

/** Below this the Wien tail at the Lyman limit is thirty decades down;
 *  integrating it buys nothing but transcendentals. */
const IONIZING_TEFF_FLOOR = 8000;

const SHORTEST_NM = 5;
const STEPS = 128;

/**
 * Hydrogen-ionizing photons per second from a star, integrated off its
 * own spectrum rather than read from a spectral-class table: the Planck
 * function below the Lyman limit, over the whole surface. Log-spaced,
 * because the integrand collapses toward short wavelengths.
 *
 * A blackbody is the model's own approximation of a stellar spectrum,
 * and for the hottest stars it runs high — real O atmospheres are line
 * blanketed and their emergent Lyman continuum is softer. The number
 * is honest about where it comes from; when a proper model-atmosphere
 * table lands, this is the one place it replaces.
 */
export function ionizingPhotonRate(tEffK: number, radiusSolar: number): number {
  if (tEffK < IONIZING_TEFF_FLOOR || radiusSolar <= 0) return 0;
  const lo = SHORTEST_NM * 1e-9;
  const hi = LYMAN_LIMIT_NM * 1e-9;
  const ratio = (hi / lo) ** (1 / STEPS);
  let photons = 0;
  let lambda = lo;
  for (let i = 0; i < STEPS; i++) {
    const next = lambda * ratio;
    const mid = Math.sqrt(lambda * next);
    // B_λ carries energy; one photon of it is hc/λ.
    photons += ((planckRadiance(mid, tEffK) * mid) / (H_PLANCK * C_LIGHT)) * (next - lambda);
    lambda = next;
  }
  const areaM2 = 4 * Math.PI * (radiusSolar * SOLAR_RADIUS) ** 2;
  // π turns radiance into what leaves a unit of surface.
  return Math.PI * photons * areaM2;
}
