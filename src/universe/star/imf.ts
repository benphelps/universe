import type { PowerLawSegment } from '../../core/rng/distributions';
import type { Rng } from '../../core/rng/rng';

/** Kroupa (2001) initial mass function segments, in M☉. */
export const KROUPA_SEGMENTS: PowerLawSegment[] = [
  { min: 0.013, max: 0.08, alpha: 0.3 },
  { min: 0.08, max: 0.5, alpha: 1.3 },
  { min: 0.5, max: 120, alpha: 2.3 },
];

// Continuity coefficients and per-segment number weights, closed form.
const coefficients: number[] = [1];
for (let i = 1; i < KROUPA_SEGMENTS.length; i++) {
  const step = KROUPA_SEGMENTS[i].alpha - KROUPA_SEGMENTS[i - 1].alpha;
  coefficients.push(coefficients[i - 1] * KROUPA_SEGMENTS[i].min ** step);
}
function segmentCount(index: number, from: number, to: number): number {
  const p = 1 - KROUPA_SEGMENTS[index].alpha;
  return (coefficients[index] * (to ** p - from ** p)) / p;
}
const weights = KROUPA_SEGMENTS.map((s, i) => segmentCount(i, s.min, s.max));
const totalWeight = weights.reduce((a, b) => a + b, 0);

/**
 * The IMF as an explicit inverse CDF: a single unit value maps
 * monotonically to a zero-age mass. Making the map explicit (rather than
 * a stream draw) is what lets the star catalog address stars by mass —
 * a seed's mass bits pass through this same function.
 */
export function initialMassFromUnit(u: number): number {
  let target = u * totalWeight;
  for (let i = 0; i < KROUPA_SEGMENTS.length; i++) {
    if (target > weights[i] && i < KROUPA_SEGMENTS.length - 1) {
      target -= weights[i];
      continue;
    }
    const segment = KROUPA_SEGMENTS[i];
    const p = 1 - segment.alpha;
    const a = segment.min ** p;
    const b = segment.max ** p;
    return (a + (target / weights[i]) * (b - a)) ** (1 / p);
  }
  return KROUPA_SEGMENTS[KROUPA_SEGMENTS.length - 1].max;
}

/** CDF inverse of initialMassFromUnit: the unit value below a mass. */
export function massUnitForMass(mass: number): number {
  let count = 0;
  for (let i = 0; i < KROUPA_SEGMENTS.length; i++) {
    const segment = KROUPA_SEGMENTS[i];
    if (mass >= segment.max) {
      count += weights[i];
      continue;
    }
    if (mass > segment.min) count += segmentCount(i, segment.min, mass);
    break;
  }
  return count / totalWeight;
}

/** Zero-age mass in M☉, brown dwarfs included. */
export function sampleInitialMass(rng: Rng): number {
  return initialMassFromUnit(rng.float());
}
