import { MASSIVE_TRACK_MASSES } from '../star/massiveTracks';
import { evolve, evolutionAgeBreaksGyr } from '../star/evolution';
import type { StellarPhysical } from '../star/types';
import { initialMassFromUnit, massUnitForMass, KROUPA_SEGMENTS } from '../star/imf';
import { componentAgeForUnit, componentUnitForAge, type PopulationComponent } from './populationAge';

export const POPULATION_NODES = [0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363];
export const POPULATION_WEIGHTS = [0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];

/** IMF-probability intervals split at track-family changes and where a
 * short phase enters/leaves the population's age range. */
export function populationMassBounds(component: PopulationComponent, bins: number): number[] {
  const min = KROUPA_SEGMENTS[0].min;
  const max = KROUPA_SEGMENTS[KROUPA_SEGMENTS.length - 1].max;
  const bounds = new Set<number>([...KROUPA_SEGMENTS.map(s => s.min), max, 0.43, 0.53, 1, (0.53 - 0.394) / 0.109, 2, ...MASSIVE_TRACK_MASSES]);
  const trackIntervals = [...bounds].filter(m => m >= 0.08).sort((a, b) => a - b);
  // Turnoff boundaries are narrow in mass: split where any phase enters
  // or leaves the component's age range as well as at IMF/track breaks.
  for (const age of [componentAgeForUnit(component, 0), componentAgeForUnit(component, 1)]) {
    for (let interval = 1; interval < trackIntervals.length; interval++) {
      const phases = evolutionAgeBreaksGyr(trackIntervals[interval - 1]).length;
      for (let phase = 0; phase < phases; phase++) {
        let lo = trackIntervals[interval - 1];
        // Each side of a discontinuous track family has its own crossing.
        let hi = trackIntervals[interval] * (1 - 1e-14);
        let flo = evolutionAgeBreaksGyr(lo)[phase] - age;
        const fhi = evolutionAgeBreaksGyr(hi)[phase] - age;
        if (flo * fhi >= 0) continue;
        for (let step = 0; step < 48; step++) {
          const mid = (lo + hi) / 2;
          const f = evolutionAgeBreaksGyr(mid)[phase] - age;
          if (f * flo > 0) { lo = mid; flo = f; } else hi = mid;
        }
        bounds.add((lo + hi) / 2);
      }
    }
  }
  for (let b = 0; b <= bins; b++) bounds.add(min * (max / min) ** (b / bins));
  return [...bounds].sort((a, b) => a - b).map(massUnitForMass);

}

/** Fixed Gauss quadrature of the same phase-aware measure as the adaptive
 * moment integrator. A callback may retain physical nodes for a luminosity
 * function; unlike a rectangular age grid, rare phases keep their duration. */
export function visitPopulationSamples(component: PopulationComponent, bins: number,
  visit: (weight: number, initialMass: number, ageGyr: number, star: StellarPhysical) => void,
  massBounds?: readonly number[], order: 2 | 4 | 8 = 2): void {
  const nodes = order === 2 ? [0.5773502691896257] : order === 4 ? [0.3399810435848563, 0.8611363115940526] : POPULATION_NODES;
  const weights = order === 2 ? [1] : order === 4 ? [0.6521451548625461, 0.3478548451374538] : POPULATION_WEIGHTS;
  const masses = massBounds ?? populationMassBounds(component, bins);
  for (let b = 1; b < masses.length; b++) {
    const halfM = (masses[b] - masses[b - 1]) / 2, midM = (masses[b] + masses[b - 1]) / 2;
    if (!(halfM > 0)) continue;
    for (let n = 0; n < nodes.length; n++) for (const signM of [-1, 1]) {
      const mass = initialMassFromUnit(midM + signM * halfM * nodes[n]);
      const ages = [...new Set([0, 1, ...evolutionAgeBreaksGyr(mass).map(t => componentUnitForAge(component, t))])].sort((a,b) => a-b);
      for (let k = 1; k < ages.length; k++) {
        const halfA = (ages[k] - ages[k - 1]) / 2, midA = (ages[k] + ages[k - 1]) / 2;
        for (let a = 0; a < nodes.length; a++) for (const signA of [-1, 1]) {
          const age = componentAgeForUnit(component, midA + signA * halfA * nodes[a]);
          visit(halfM * weights[n] * halfA * weights[a], mass, age, evolve(mass, age));
        }
      }
    }
  }
}
