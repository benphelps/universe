import type { Mu, Seconds } from '../physics/units';
/**
 * Classical Keplerian elements. Angles in radians, lengths in meters,
 * epoch/time in seconds. Reference plane is the parent's equatorial or
 * invariable plane depending on context.
 */
export interface OrbitalElements {
  semiMajorAxis: number;
  eccentricity: number;
  inclination: number;
  longitudeOfAscendingNode: number;
  argumentOfPeriapsis: number;
  meanAnomalyAtEpoch: number;
  epoch: number;
}

/** Mean motion n = √(μ/a³) in rad/s. */
export function meanMotion(mu: Mu, semiMajorAxis: number): number {
  return Math.sqrt(mu / semiMajorAxis ** 3);
}

/** Orbital period in seconds. */
export function orbitalPeriod(mu: Mu, semiMajorAxis: number): number {
  return (2 * Math.PI) / meanMotion(mu, semiMajorAxis);
}

/** Mean anomaly at time t, wrapped to [0, 2π). */
export function meanAnomalyAt(el: OrbitalElements, mu: Mu, t: Seconds): number {
  const raw = el.meanAnomalyAtEpoch + meanMotion(mu, el.semiMajorAxis) * (t - el.epoch);
  const tau = 2 * Math.PI;
  return ((raw % tau) + tau) % tau;
}
