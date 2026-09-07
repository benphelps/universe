import { opticalRgbInterpolator } from '../../core/color/optical';
import { evolve, evolutionAgeBreaksGyr } from '../star/evolution';
import { initialMassFromUnit, massUnitForMass } from '../star/imf';
import { populationMomentTable } from './populationMomentTable';
import { componentAgeForUnit, componentUnitForAge, type PopulationComponent } from './populationAge';
import { populationMassBounds, POPULATION_NODES as NODES, POPULATION_WEIGHTS as WEIGHTS } from './populationQuadrature';
export { populationMassBounds } from './populationQuadrature';

export interface PopulationMoments {
  massSolar: number;
  /** Bolometric power, retained for mass/energy accounting. */
  luminositySolar: number;
  /** 380–780 nm power with CIE hue; RGB luminance is optical L☉/star. */
  opticalRgbSolar: readonly [number, number, number];
}
const emptyMoments = () => ({ massSolar: 0, luminositySolar: 0, opticalRgbSolar: [0, 0, 0] as [number, number, number] });
function addMoments(to: ReturnType<typeof emptyMoments>, from: PopulationMoments, weight = 1): void {
  to.massSolar += weight * from.massSolar;
  to.luminositySolar += weight * from.luminositySolar;
  for (let c = 0; c < 3; c++) to.opticalRgbSolar[c] += weight * from.opticalRgbSolar[c];
}
let opticalLookup: ReturnType<typeof opticalRgbInterpolator> | undefined;

/** Present-day mass and light use the full IMF, including brown dwarfs
 * and remnants, and the same ages as generated component stars. Bright
 * track phases are integrated over their actual duration, never counted
 * only when a sparse, uniform age sample happens to hit them. */
export function populationMoments(component: PopulationComponent): Readonly<PopulationMoments> {
  // These component age laws and the IMF/track model are seed-independent.
  // Generate this tiny table offline; tests independently integrate it so an
  // evolution change cannot silently leave stale mass or light in production.
  return populationMomentTable[component];
}

/** Uncached quadrature for convergence checks. Log-mass intervals each
 * integrate in IMF probability; age intervals split at track transitions
 * and integrate in the component's age probability. */
export function integratePopulationMoments(component: PopulationComponent, bins = 64,
  massWeight: (initialMass: number) => number = () => 1,
  extraMassBounds: readonly number[] = []): PopulationMoments {
  const opticalRgb = opticalLookup ??= opticalRgbInterpolator();
  const masses = [...new Set([...populationMassBounds(component, bins), ...extraMassBounds.map(massUnitForMass)])].sort((a,b) => a-b);
  const atMass = (unit: number): PopulationMoments => {
    const initial = initialMassFromUnit(unit);
    const ageBounds = [...new Set([0, 1, ...evolutionAgeBreaksGyr(initial).map(t => componentUnitForAge(component, t))])].sort((a, b) => a - b);
    const result = emptyMoments();
    for (let k = 1; k < ageBounds.length; k++) {
      const half = (ageBounds[k] - ageBounds[k - 1]) / 2;
      const mid = (ageBounds[k] + ageBounds[k - 1]) / 2;
      for (let n = 0; n < 4; n++) for (const sign of [-1, 1]) {
        const star = evolve(initial, componentAgeForUnit(component, mid + sign * half * NODES[n]));
        result.massSolar += half * WEIGHTS[n] * star.mass;
        const power = half * WEIGHTS[n] * star.luminosity;
        result.luminositySolar += power;
        const rgb = opticalRgb(star.tEff);
        for (let c = 0; c < 3; c++) result.opticalRgbSolar[c] += power * rgb[c];
      }
    }
    const weight = massWeight(initial);
    result.massSolar *= weight;
    result.luminositySolar *= weight;
    for (let c = 0; c < 3; c++) result.opticalRgbSolar[c] *= weight;
    return result;
  };
  const quadrature = (lo: number, hi: number): PopulationMoments => {
    const half = (hi - lo) / 2, mid = (lo + hi) / 2;
    const result = emptyMoments();
    for (let n = 0; n < 4; n++) for (const sign of [-1, 1]) {
      const sample = atMass(mid + sign * half * NODES[n]);
      addMoments(result, sample, half * WEIGHTS[n]);
    }
    return result;
  };
  const refine = (lo: number, hi: number, coarse: PopulationMoments, depth: number): PopulationMoments => {
    const mid = (lo + hi) / 2;
    const left = quadrature(lo, mid), right = quadrature(mid, hi);
    const result = emptyMoments();
    addMoments(result, left); addMoments(result, right);
    // Fuel limits and IFMR transitions introduce kinks in mass even when
    // the age integral is resolved. Refine those intervals, with a bounded
    // depth and error allowance proportional to their IMF probability.
    if (depth < 12 && (Math.abs(result.massSolar - coarse.massSolar) > 1e-9 * (hi - lo)
      || Math.abs(result.luminositySolar - coarse.luminositySolar) > 1e-7 * (hi - lo)
      || result.opticalRgbSolar.some((v, c) => Math.abs(v - coarse.opticalRgbSolar[c]) > 1e-7 * (hi - lo)))) {
      const a = refine(lo, mid, left, depth + 1), b = refine(mid, hi, right, depth + 1);
      const combined = emptyMoments();
      addMoments(combined, a); addMoments(combined, b);
      return combined;
    }
    return result;
  };
  const result = emptyMoments();
  for (let b = 1; b < masses.length; b++) {
    if (masses[b] <= masses[b - 1]) continue;
    const part = refine(masses[b - 1], masses[b], quadrature(masses[b - 1], masses[b]), 0);
    addMoments(result, part);
  }
  return result;
}
