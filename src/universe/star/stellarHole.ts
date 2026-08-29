import {
  clampSpin,
  gravitationalRadius,
  horizonRadiusRg,
  iscoRadiusRg,
  photonSphereRadiusRg,
  shadowImpactParameterRg,
} from '../../core/physics/blackHole';
import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { accretionFlowFor, type AccretionFlow } from '../galaxy/accretionFlow';
import { feedingFor, type CompactFeeding, type Donor } from './compactAccretion';
import type { Star } from './types';

/**
 * A black hole left by a star, as a thing that can be looked at.
 *
 * The geometry is the same closed form the galactic nucleus uses —
 * there is only one kind of black hole and only one scale in it, so a
 * ten solar mass hole is a hundred-million solar mass hole reduced by
 * seven orders of magnitude and nothing else. What differs is entirely
 * what is falling in, and for a stellar hole that is decided by the
 * company it keeps rather than by a galaxy's gas supply.
 *
 * Which is why most of them are dark. A hole with no companion close
 * enough to reach it is a lens and a shadow: the picture is the sky
 * behind it, bent, and nothing more.
 */

export interface StellarBlackHole {
  massSolar: number;
  /** Dimensionless a★ = Jc/GM². */
  spin: number;
  /** GM/c², metres. */
  gravitationalRadiusM: number;
  horizonRadiusM: number;
  photonSphereRadiusM: number;
  iscoRadiusM: number;
  /** Apparent radius of the shadow to a distant viewer, metres. */
  shadowRadiusM: number;
  /** Unit spin axis. The flow lies square across it, and it points
   *  along whatever angular momentum is arriving — the orbit of the
   *  donor for a fed hole, the progenitor's own spin for a starved one. */
  spinAxis: [number, number, number];
  feeding: CompactFeeding;
  flow: AccretionFlow;
}

/**
 * Natal spin, dimensionless.
 *
 * Genuinely uncertain: measured spins in X-ray binaries run the whole
 * range from barely turning to within a percent of the Thorne limit,
 * and which progenitors leave which is not settled. What is expected is
 * a trend — a heavy hole comes from a heavy star, and a heavy star sheds
 * its envelope in a wind that carries off angular momentum long before
 * the core collapses, so the heaviest tend to be born slowest. That
 * trend is here; the scatter around it is the seed's.
 */
function natalSpin(rng: Rng, massSolar: number): number {
  const heavy = Math.min(1, Math.max(0, (massSolar - 5) / 45));
  return clampSpin(0.998 * rng.float() ** (0.45 + 1.3 * heavy));
}

/**
 * The hole a black-hole star is, given whatever else is in its system.
 * `donors` are the other stars and how far away they orbit; `axis` is
 * the direction angular momentum arrives from, which for anything being
 * fed is the plane its donor orbits in.
 */
export function stellarBlackHole(
  star: Star,
  donors: readonly Donor[],
  axis: readonly [number, number, number],
): StellarBlackHole {
  const massSolar = star.mass;
  const rng = new Rng(deriveSeed(BigInt(`0x${star.seedHex}`), 'hole'));
  const spin = natalSpin(rng, massSolar);
  const feeding = feedingFor(massSolar, spin, donors);
  const gravitationalRadiusM = gravitationalRadius(massSolar);
  const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;

  return {
    massSolar,
    spin,
    gravitationalRadiusM,
    horizonRadiusM: horizonRadiusRg(spin) * gravitationalRadiusM,
    photonSphereRadiusM: photonSphereRadiusRg(spin) * gravitationalRadiusM,
    iscoRadiusM: iscoRadiusRg(spin) * gravitationalRadiusM,
    shadowRadiusM: shadowImpactParameterRg() * gravitationalRadiusM,
    spinAxis: [axis[0] / length, axis[1] / length, axis[2] / length],
    feeding,
    flow: accretionFlowFor(massSolar, spin, feeding.eddingtonRatio),
  };
}

/**
 * Whether this hole has anything worth drawing around it. Below a part
 * in ten billion of Eddington the flow is colder and fainter than the
 * sky behind it, and what the eye gets is the lensing alone — which is
 * the honest picture of nearly every black hole in a galaxy.
 */
export function hasVisibleFlow(hole: StellarBlackHole): boolean {
  return hole.feeding.eddingtonRatio > 1e-10;
}
