import { SOLAR_TEFF } from '../../core/physics/constants';
import { MASSIVE_TRACK_MIN, massiveMsLifetimeGyr, massiveStarState, massiveZamsLuminosity } from './massiveTracks';

/**
 * Empirical main-sequence mass–luminosity relation (piecewise), L☉ from M☉.
 * Below 8 M☉ this is the legacy scale modulated by evolution.ts. Above
 * that boundary it is the actual mid-MS luminosity of the reference grid.
 */
export function msLuminosity(mass: number): number {
  if (mass >= MASSIVE_TRACK_MIN) return massiveStarState(mass, 0.5 * massiveMsLifetimeGyr(mass)).luminosity;
  if (mass < 0.43) return 0.23 * mass ** 2.3;
  if (mass < 2) return mass ** 4;
  return 1.4 * mass ** 3.5;
}

/** Initial luminosity for formation/irradiation, without a fixed conversion
 * from mid-MS luminosity that fails for massive evolving stars. */
export function zamsLuminosity(mass: number): number {
  return mass >= MASSIVE_TRACK_MIN ? massiveZamsLuminosity(mass) : 0.75 * msLuminosity(mass);
}

/** Empirical low-mass radius / reference-grid mid-MS radius, in R☉. */
export function msRadius(mass: number): number {
  if (mass >= MASSIVE_TRACK_MIN) return massiveStarState(mass, 0.5 * massiveMsLifetimeGyr(mass)).radius;
  return mass < 1 ? mass ** 0.8 : mass ** 0.57;
}

/** Main-sequence lifetime in Gyr. Massive stars use the same track as
 * their luminosity and temperature; no independent lifetime floor is added
 * to an unrelated high-mass luminosity power law. */
export function msLifetimeGyr(mass: number): number {
  return mass >= MASSIVE_TRACK_MIN ? massiveMsLifetimeGyr(mass) : (10 * mass) / msLuminosity(mass) + 0.0032;
}

/** Effective temperature from L and R (solar units) via Stefan–Boltzmann. */
export function tEffFromLR(luminosity: number, radius: number): number {
  return SOLAR_TEFF * (luminosity ** 0.25 / Math.sqrt(radius));
}

/** Radius (R☉) implied by L (L☉) and T_eff (K) — the inverse of tEffFromLR. */
export function radiusFromLT(luminosity: number, tEff: number): number {
  return Math.sqrt(luminosity) * (SOLAR_TEFF / tEff) ** 2;
}
