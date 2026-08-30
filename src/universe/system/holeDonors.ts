import { AU } from '../../core/physics/constants';
import type { Donor } from '../star/compactAccretion';
import type { StarSystem } from './types';

/**
 * What a compact member of this system has to feed on.
 *
 * Everything else in the system, and how far away it orbits. A primary
 * is orbited by every companion at that companion's own semi-major
 * axis; a companion has the primary at its own axis, and the rest at
 * the difference between theirs and its — which is the separation of
 * two nested orbits at their closest approach in the mean, and near
 * enough for a rate that falls off as a power of it.
 *
 * A property of the system, not of the camera, which is why it does not
 * live on the viewer: what a hole is being fed is a fact about the
 * system it sits in, and anything that wants to know — a panel quoting
 * a rate, a renderer drawing a disc — has to get the same answer.
 */
export function holeDonors(system: StarSystem, index: number): Donor[] {
  const donors: Donor[] = [];
  if (index === 0) {
    for (const companion of system.companions) {
      donors.push({
        star: companion.star,
        separationAu: companion.elements.semiMajorAxis / AU,
      });
    }
    return donors;
  }
  const own = system.companions[index - 1];
  if (!own) return donors;
  donors.push({ star: system.star, separationAu: own.elements.semiMajorAxis / AU });
  for (let i = 0; i < system.companions.length; i++) {
    if (i === index - 1) continue;
    const other = system.companions[i];
    donors.push({
      star: other.star,
      separationAu: Math.abs(other.elements.semiMajorAxis - own.elements.semiMajorAxis) / AU,
    });
  }
  return donors;
}
