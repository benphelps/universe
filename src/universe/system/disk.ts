import { logNormal } from '../../core/rng/distributions';
import type { Rng } from '../../core/rng/rng';
import { zamsLuminosity } from '../star/mainSequence';
import type { Star } from '../star/types';
import { EARTH_MASS, SOLAR_MASS } from '../../core/physics/constants';

/** Earth masses per M☉. */
const SOLAR_IN_EARTH = SOLAR_MASS / EARTH_MASS;
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

  const birthLuminosity = zamsLuminosity(star.massInitial);
  const disk: DiskModel = {
    massSolar,
    outerAu,
    sigma0: 0,
    frostLineAu: 2.7 * Math.sqrt(birthLuminosity),
    // Sub-linear in metal fraction: observed small-planet occurrence is
    // nearly flat in [Fe/H] (planetesimal formation compensates), while
    // giants stay steeply metallicity-dependent through the core-mass
    // threshold downstream.
    metallicityBoost: 10 ** (0.55 * star.feH),
  };
  // Normalize the gas column; its associated dust completes the total disk mass.
  disk.sigma0 = diskMassBudget(disk).gasEarth /
    (4 * Math.PI * (Math.sqrt(outerAu) - Math.sqrt(NORMALIZATION_INNER_AU)));
  return disk;
}

/** Finite solid/gas reservoirs under the same surface-density law used
 *  by feeding zones. The frost line partitions the integral in sqrt(a). */
export function diskMassBudget(disk: DiskModel): { totalEarth: number; solidEarth: number; gasEarth: number } {
  const inner = Math.sqrt(NORMALIZATION_INNER_AU);
  const outer = Math.sqrt(disk.outerAu);
  const frost = Math.sqrt(Math.max(NORMALIZATION_INNER_AU, Math.min(disk.outerAu, disk.frostLineAu)));
  const dustGasRatio = disk.metallicityBoost *
    (ROCK_FRACTION * (frost - inner) + ROCK_ICE_FRACTION * (outer - frost)) / (outer - inner);
  const totalEarth = disk.massSolar * SOLAR_IN_EARTH;
  const gasEarth = totalEarth / (1 + dustGasRatio);
  return { totalEarth, gasEarth, solidEarth: totalEarth - gasEarth };
}

/** Solid surface density at a, in M⊕/AU². */
export function solidSurfaceDensity(disk: DiskModel, aAu: number): number {
  const solidFraction = aAu < disk.frostLineAu ? ROCK_FRACTION : ROCK_ICE_FRACTION;
  return disk.sigma0 * aAu ** -1.5 * solidFraction * disk.metallicityBoost;
}

/** Exact solid column integral, clipped to the formation disk. */
export function diskSolidsBetween(disk: DiskModel, innerAu: number, outerAu: number): number {
  const lo = Math.max(NORMALIZATION_INNER_AU, innerAu);
  const hi = Math.min(disk.outerAu, outerAu);
  if (!(hi > lo)) return 0;
  const frost = Math.max(lo, Math.min(hi, disk.frostLineAu));
  return 4 * Math.PI * disk.sigma0 * disk.metallicityBoost * (
    ROCK_FRACTION * (Math.sqrt(frost) - Math.sqrt(lo)) +
    ROCK_ICE_FRACTION * (Math.sqrt(hi) - Math.sqrt(frost))
  );
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
