import { SOLAR_TEFF } from '../../core/physics/constants';
import { MASSIVE_MASSES, MASSIVE_MS_INDEX, MASSIVE_PHASE_ROWS, MASSIVE_TRACKS } from './massiveTrackData';
import type { StellarPhysical } from './types';

/** Solar-metallicity, v/vcrit=0.4 reference tracks. The fixed rotation grid
 * is a population approximation, independent of the activity spin draw.
 * 8–9 M☉ bridges from the old 8-M☉ boundary to the published 9-M☉ track. */
export const MASSIVE_TRACK_MIN = 8;
export const MASSIVE_TRACK_MASSES: readonly number[] = MASSIVE_MASSES;
const LAST = MASSIVE_PHASE_ROWS.length - 1;
const LOG_MASSES = MASSIVE_MASSES.map(Math.log);

// Reuse just the interpolation bracket, not a heap of per-seed tracks.
let lastMass = NaN, left = 0, weight = 0;
function bracket(mass: number): void {
  if (lastMass === mass) return;
  const logMass = Math.log(Math.max(MASSIVE_TRACK_MIN, Math.min(120, mass)));
  left = 0;
  while (left < MASSIVE_MASSES.length - 2 && logMass >= LOG_MASSES[left + 1]) left++;
  weight = (logMass - LOG_MASSES[left]) / (LOG_MASSES[left + 1] - LOG_MASSES[left]);
  lastMass = mass;
}
function at(index: number, column: number): number {
  const a = MASSIVE_TRACKS[left][4 * index + column];
  return a + weight * (MASSIVE_TRACKS[left + 1][4 * index + column] - a);
}
function massFraction(index: number): number {
  const a = MASSIVE_TRACKS[left][4 * index + 1] / MASSIVE_MASSES[left];
  const b = MASSIVE_TRACKS[left + 1][4 * index + 1] / MASSIVE_MASSES[left + 1];
  return a + weight * (b - a);
}

export function massiveMsLifetimeGyr(mass: number): number {
  bracket(mass);
  return at(MASSIVE_MS_INDEX, 0);
}
export function massiveLifetimeGyr(mass: number): number {
  bracket(mass);
  return at(LAST, 0);
}
export function massiveFinalMass(mass: number): number {
  bracket(mass);
  return mass * massFraction(LAST);
}
export function massiveZamsLuminosity(mass: number): number {
  bracket(mass);
  return 10 ** at(0, 2);
}
/** Every retained age segment is linear in log L, so its maximum occurs
 * at an endpoint. Avoid assembling hundreds of full L/R/T states merely
 * to initialize a conservative catalogue brightness bound. */
export function massivePeakLuminosity(mass: number): number {
  bracket(mass);
  let logPeak = -Infinity;
  for (let i = 0; i <= LAST; i++) logPeak = Math.max(logPeak, at(i, 2));
  return 10 ** logPeak;
}
export function massiveAgeBreaksGyr(mass: number): number[] {
  bracket(mass);
  return MASSIVE_PHASE_ROWS.map((_, i) => at(i, 0));
}

/** Interpolate homologous phase rows in log initial mass, then locate age
 * inside that track. Linear ages and mass fractions, logarithmic L and T.
 * Interpolating fractions (not total mass) prevents manufacturing mass
 * between the tabulated initial masses. No track allocation per star. */
export function massiveStarState(mass: number, ageGyr: number): StellarPhysical {
  bracket(mass);
  const age = Math.max(0, Math.min(at(LAST, 0), ageGyr));
  let lo = 0, hi = LAST;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (at(mid, 0) <= age) lo = mid; else hi = mid;
  }
  const start = at(lo, 0), end = at(hi, 0);
  const p = end > start ? (age - start) / (end - start) : 1;
  const logL = at(lo, 2) + p * (at(hi, 2) - at(lo, 2));
  const logT = at(lo, 3) + p * (at(hi, 3) - at(lo, 3));
  const luminosity = 10 ** logL, tEff = 10 ** logT;
  return {
    // This is the evolutionary phase, not a wind/spectral classification.
    stage: age < at(MASSIVE_MS_INDEX, 0) ? 'main-sequence' : 'supergiant',
    mass: mass * (massFraction(lo) + p * (massFraction(hi) - massFraction(lo))),
    luminosity, tEff, radius: Math.sqrt(luminosity) * (SOLAR_TEFF / tEff) ** 2,
  };
}
