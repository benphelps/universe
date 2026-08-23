import type { Rng } from '../../core/rng/rng';
import { rayleigh } from '../../core/rng/distributions';
import type { CompanionOrbit } from './types';

export interface CompanionSpec {
  massSolar: number;
  orbit: CompanionOrbit;
}

/** Fraction of primaries with at least one stellar companion, by mass. */
export function multiplicityFraction(massSolar: number): number {
  if (massSolar < 0.3) return 0.25;
  if (massSolar < 0.8) return 0.35;
  if (massSolar < 1.3) return 0.45;
  if (massSolar < 3) return 0.6;
  return 0.8;
}

/**
 * Companion mass and orbit specs for a primary. Periods follow the
 * Raghavan (2010) log-normal (peak log₁₀P[d] ≈ 5, σ ≈ 2.3); mass ratios
 * roughly uniform; close pairs are tidally circularized. A second, wider
 * companion (hierarchical triple) appears with period separation enforced
 * for stability.
 */
export function generateCompanionSpecs(rng: Rng, primaryMassSolar: number): CompanionSpec[] {
  if (!rng.bool(multiplicityFraction(primaryMassSolar))) return [];

  const specs: CompanionSpec[] = [];
  let previousLogP = -Infinity;
  const count = rng.bool(0.25) ? 2 : 1;
  for (let i = 0; i < count; i++) {
    let logP = rng.normal(5.03, 2.28);
    if (logP < previousLogP + 1.2) logP = previousLogP + 1.2;
    logP = Math.min(9.5, Math.max(-0.3, logP));
    previousLogP = logP;

    const massSolar = Math.max(0.013, rng.range(0.15, 0.95) * primaryMassSolar);
    const periodDays = 10 ** logP;
    const periodYears = periodDays / 365.25;
    const semiMajorAxisAu = Math.cbrt(periodYears ** 2 * (primaryMassSolar + massSolar));
    const eccentricity =
      periodDays < 10 ? rng.range(0, 0.05) : Math.min(0.9, rayleigh(rng, 0.3));

    specs.push({ massSolar, orbit: { periodDays, semiMajorAxisAu, eccentricity } });
  }
  return specs;
}
