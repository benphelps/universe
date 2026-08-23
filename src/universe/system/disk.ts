import { logNormal } from '../../core/rng/distributions';
import type { Rng } from '../../core/rng/rng';
import { msLuminosity } from '../star/mainSequence';
import type { Star } from '../star/types';

/** Earth masses per M☉. */
const SOLAR_IN_EARTH = 333000;
/** g·cm⁻² per (M⊕·AU⁻²). */
const G_CM2_PER_EARTH_AU2 = 26.7;

/**
 * Protoplanetary disk recipe: closed-form parameters that shape planet
 * sampling. Surface density Σ ∝ a^-1.5 (MMSN-like); solids are the rock
 * fraction inside the formation-era frost line and rock+ice beyond,
 * scaled by stellar metallicity.
 */
export interface DiskModel {
  massSolar: number;
  outerAu: number;
  /** Gas surface density at 1 AU, M⊕/AU². */
  sigma0: number;
  /** Formation-era frost line (ZAMS luminosity). */
  frostLineAu: number;
  metallicityBoost: number;
}

const ROCK_FRACTION = 0.004;
const ROCK_ICE_FRACTION = 0.012;
const NORMALIZATION_INNER_AU = 0.05;

export function generateDisk(rng: Rng, star: Star): DiskModel {
  const massFraction = Math.min(0.15, Math.max(0.003, logNormal(rng, Math.log(0.03), 0.7)));
  const massSolar = massFraction * star.massInitial;
  const outerAu = rng.range(25, 60) * Math.sqrt(star.massInitial);

  // Σ(a) = Σ₀·a^-1.5 with ∫2πaΣda over [inner, outer] equal to the disk mass.
  const massEarth = massSolar * SOLAR_IN_EARTH;
  const sigma0 = massEarth / (4 * Math.PI * (Math.sqrt(outerAu) - Math.sqrt(NORMALIZATION_INNER_AU)));

  const zamsLuminosity = 0.75 * msLuminosity(star.massInitial);
  return {
    massSolar,
    outerAu,
    sigma0,
    frostLineAu: 2.7 * Math.sqrt(zamsLuminosity),
    metallicityBoost: 10 ** star.feH,
  };
}

/** Solid surface density at a, in M⊕/AU². */
export function solidSurfaceDensity(disk: DiskModel, aAu: number): number {
  const solidFraction = aAu < disk.frostLineAu ? ROCK_FRACTION : ROCK_ICE_FRACTION;
  return disk.sigma0 * aAu ** -1.5 * solidFraction * disk.metallicityBoost;
}

/**
 * Isolation mass in M⊕: the embryo mass that consumes its feeding zone
 * (~10 Hill radii of solids). Final planet masses multiply this by a
 * consolidation factor for the giant-impact merger phase.
 */
export function isolationMassEarth(disk: DiskModel, aAu: number, starMassSolar: number): number {
  const sigmaGcm2 = solidSurfaceDensity(disk, aAu) * G_CM2_PER_EARTH_AU2;
  return 0.16 * (sigmaGcm2 / 10) ** 1.5 * aAu ** 3 / Math.sqrt(starMassSolar);
}
