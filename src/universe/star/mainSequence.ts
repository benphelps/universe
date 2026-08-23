import { SOLAR_TEFF } from '../../core/physics/constants';

/**
 * Empirical main-sequence mass–luminosity relation (piecewise), L☉ from M☉.
 * Represents mid-main-sequence luminosity; evolution.ts modulates across
 * the main-sequence lifetime.
 */
export function msLuminosity(mass: number): number {
  if (mass < 0.43) return 0.23 * mass ** 2.3;
  if (mass < 2) return mass ** 4;
  if (mass < 55) return 1.4 * mass ** 3.5;
  // Eddington-flattened: linear continuation from the 55 M☉ point.
  return 1.4 * 55 ** 3.5 * (mass / 55);
}

/** Empirical main-sequence mass–radius relation, R☉ from M☉. */
export function msRadius(mass: number): number {
  return mass < 1 ? mass ** 0.8 : mass ** 0.57;
}

/** Main-sequence lifetime in Gyr: nuclear-timescale scaling. */
export function msLifetimeGyr(mass: number): number {
  return (10 * mass) / msLuminosity(mass);
}

/** Effective temperature from L and R (solar units) via Stefan–Boltzmann. */
export function tEffFromLR(luminosity: number, radius: number): number {
  return SOLAR_TEFF * (luminosity ** 0.25 / Math.sqrt(radius));
}

/** Radius (R☉) implied by L (L☉) and T_eff (K) — the inverse of tEffFromLR. */
export function radiusFromLT(luminosity: number, tEff: number): number {
  return Math.sqrt(luminosity) * (SOLAR_TEFF / tEff) ** 2;
}
