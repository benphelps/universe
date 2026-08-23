/**
 * Holman & Wiegert (1999) empirical stability limits for planets in
 * binary systems. mu is the companion's mass fraction m₂/(m₁+m₂),
 * e the binary eccentricity, a_bin the binary semi-major axis.
 */

/** Outermost stable circumstellar (S-type) orbit around the primary. */
export function sTypeCriticalAu(aBinAu: number, e: number, mu: number): number {
  const factor =
    0.464 - 0.38 * mu - 0.631 * e + 0.586 * mu * e + 0.15 * e * e - 0.198 * mu * e * e;
  return Math.max(0.01, factor * aBinAu);
}

/** Innermost stable circumbinary (P-type) orbit around the pair. */
export function pTypeCriticalAu(aBinAu: number, e: number, mu: number): number {
  const factor =
    1.6 + 5.1 * e - 2.22 * e * e + 4.12 * mu - 4.27 * e * mu - 5.09 * mu * mu +
    4.61 * e * e * mu * mu;
  return factor * aBinAu;
}
