import type { OrbitalElements } from '../../core/math/orbit';
import { AU } from '../../core/physics/constants';
import { mutualHillFactor, type PlanetSlot } from './architecture';

/** Minimum mutual-Hill spacing for long-term stability of a chain. */
const MIN_HILL_SPACING = 8;
/** Closest-approach margin, in mutual Hill radii. */
const CROSSING_MARGIN = 3;

export interface StablePlanet {
  slot: PlanetSlot;
  elements: OrbitalElements;
}

/**
 * Analytic stability filter: adjacent pairs must be spaced by at least
 * MIN_HILL_SPACING mutual Hill radii and their orbits must not approach
 * within CROSSING_MARGIN of them at periapsis/apoapsis. Violators lose
 * the lighter body — the physical outcome of an instability.
 */
export function filterStable(
  slots: PlanetSlot[],
  elements: OrbitalElements[],
  centralMassSolar: number,
): StablePlanet[] {
  const planets: StablePlanet[] = slots
    .map((slot, i) => ({ slot, elements: elements[i] }))
    .sort((a, b) => a.slot.aAu - b.slot.aAu);

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i + 1 < planets.length; i++) {
      const inner = planets[i];
      const outer = planets[i + 1];
      const meanA = (inner.slot.aAu + outer.slot.aAu) / 2;
      const hillAu =
        mutualHillFactor(inner.slot.massEarth, outer.slot.massEarth, centralMassSolar) * meanA;

      const spacing = (outer.slot.aAu - inner.slot.aAu) / hillAu;
      const innerApoAu = (inner.elements.semiMajorAxis / AU) * (1 + inner.elements.eccentricity);
      const outerPeriAu = (outer.elements.semiMajorAxis / AU) * (1 - outer.elements.eccentricity);
      const approach = (outerPeriAu - innerApoAu) / hillAu;

      if (spacing < MIN_HILL_SPACING || approach < CROSSING_MARGIN) {
        const removeIndex = inner.slot.massEarth <= outer.slot.massEarth ? i : i + 1;
        planets.splice(removeIndex, 1);
        changed = true;
        break;
      }
    }
  }
  return planets;
}
