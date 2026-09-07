import { companionMassDensity, FIELD_OBJECTS_PER_SYSTEM, FIELD_MASS_BREAKS } from './fieldMultiplicity';
import { initialMassDensity, massUnitForMass } from '../star/imf';
import { opticalRgbInterpolator, rgbLuminance } from '../../core/color/optical';
import { galaxyFieldStarCounts } from './stellarMass';
import { SMOOTH_MODEL } from './density';
import { visitPopulationSamples, populationMassBounds } from './populationQuadrature';

import { OVERVIEW_STAR_COUNT, OVERVIEW_RADIUS_PC } from './overviewSurvey';
export function overviewThinCount(): number {
  const radius = OVERVIEW_RADIUS_PC / SMOOTH_MODEL.thinScaleLengthPc;
  return galaxyFieldStarCounts().thin * (1 - (1 + radius) * Math.exp(-radius));
}
export interface OverviewSourceNode {
  /** Expected number within the optical bright tail. */
  count: number;
  initialMass: number;
  ageGyr: number;
  mass: number;
  bolometric: number;
  opticalRgb: [number, number, number];
}
export interface OverviewPopulation {
  count: number;
  expectedRgb: [number, number, number];
  cutoffOptical: number;
  nodes: OverviewSourceNode[];
}
/** Offline luminosity-function construction, using physical phase-aware
 * mass/age nodes. The renderer never invents a star colour or brightness. */
export function integrateOverviewPopulation(bins = 256, order: 2 | 4 | 8 = 4): OverviewPopulation {
  const optical = opticalRgbInterpolator(), count = overviewThinCount();
  const candidates: OverviewSourceNode[] = [];
  visitPopulationSamples('thin-disk', bins, (weight, initialMass, ageGyr, star) => {
    if (star.luminosity < 100 || star.tEff <= 0) return;
    const rgb = optical(star.tEff).map(v => v * star.luminosity) as [number,number,number];
    if (rgbLuminance(rgb) < 100) return;
    const fieldWeight = (1+companionMassDensity(initialMass)/initialMassDensity(initialMass))/FIELD_OBJECTS_PER_SYSTEM;
    candidates.push({count:weight*fieldWeight*count, initialMass,ageGyr,mass:star.mass,bolometric:star.luminosity,opticalRgb:rgb});
  }, [...new Set([...populationMassBounds('thin-disk',bins),...FIELD_MASS_BREAKS.map(massUnitForMass)])].sort((a,b)=>a-b), order);
  candidates.sort((a,b) => rgbLuminance(b.opticalRgb)-rgbLuminance(a.opticalRgb));
  const result: OverviewPopulation = {count:0,expectedRgb:[0,0,0],cutoffOptical:0,nodes:[]};
  for (const node of candidates) {
    const take = Math.min(node.count, OVERVIEW_STAR_COUNT-result.count);
    if (take <= 0) break;
    result.nodes.push({...node,count:take});result.count+=take;
    for(let c=0;c<3;c++)result.expectedRgb[c]+=take*node.opticalRgb[c];
    result.cutoffOptical=rgbLuminance(node.opticalRgb);
  }
  if(result.count!==OVERVIEW_STAR_COUNT)throw Error('Overview bright-tail candidate floor is too high');
  return result;
}

/** Equal-number luminosity-function bins. Each carries its integrated RGB
 * mean, so compression preserves the selected population's colour and power
 * exactly. These statistical light elements have no catalogue identity. */
export function compressOverviewPopulation(population: OverviewPopulation, bins = 1024): number[][] {
  const result: number[][] = [];
  let node = 0, used = 0;
  for (let bin = 0; bin < bins; bin++) {
    const count = population.count / bins, rgb = [0,0,0];
    let remaining = count;
    while (remaining > count * 1e-10 && node < population.nodes.length) {
      const source = population.nodes[node], take = Math.min(source.count-used, remaining);
      for(let c=0;c<3;c++)rgb[c]+=take*source.opticalRgb[c];
      remaining-=take;used+=take;
      if(used>=source.count-1e-12){node++;used=0;}
    }
    result.push(rgb.map(v=>v/count));
  }
  return result;
}
