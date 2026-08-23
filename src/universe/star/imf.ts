import { brokenPowerLaw, type PowerLawSegment } from '../../core/rng/distributions';
import type { Rng } from '../../core/rng/rng';

/** Kroupa (2001) initial mass function segments, in M☉. */
export const KROUPA_SEGMENTS: PowerLawSegment[] = [
  { min: 0.013, max: 0.08, alpha: 0.3 },
  { min: 0.08, max: 0.5, alpha: 1.3 },
  { min: 0.5, max: 120, alpha: 2.3 },
];

/** Zero-age mass in M☉, brown dwarfs included. */
export function sampleInitialMass(rng: Rng): number {
  return brokenPowerLaw(rng, KROUPA_SEGMENTS);
}
