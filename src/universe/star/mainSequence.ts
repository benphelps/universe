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

/**
 * Main-sequence lifetime in Gyr.
 *
 * The nuclear timescale 10 M/L assumes a fixed fuel fraction, which is
 * right for sunlike stars and increasingly wrong above ~10 M☉: a
 * massive star burns a growing convective core while its luminosity is
 * Eddington-pinned toward L ∝ M, so fuel and burn rate both scale with
 * mass and the lifetime asymptotes instead of collapsing — every track
 * grid puts the most massive stars near 3–4 Myr, not the tenths the
 * bare formula gives. The additive floor is that asymptote, and the
 * crossover falls out at ~25 M☉ on its own: 60 M☉ lands at 3.5 Myr,
 * 20 M☉ at 7.2, 9 M☉ at 33, and below 5 M☉ the term vanishes into
 * the classical estimate.
 */
export function msLifetimeGyr(mass: number): number {
  return (10 * mass) / msLuminosity(mass) + 0.0032;
}

/** Effective temperature from L and R (solar units) via Stefan–Boltzmann. */
export function tEffFromLR(luminosity: number, radius: number): number {
  return SOLAR_TEFF * (luminosity ** 0.25 / Math.sqrt(radius));
}

/** Radius (R☉) implied by L (L☉) and T_eff (K) — the inverse of tEffFromLR. */
export function radiusFromLT(luminosity: number, tEff: number): number {
  return Math.sqrt(luminosity) * (SOLAR_TEFF / tEff) ** 2;
}
