import { opticalRgbInterpolator } from '../../core/color/optical';
import { evolve } from '../star/evolution';
import { initialMassDensity } from '../star/imf';
import { componentAgeForUnit, type StellarComponent } from './populationAge';
import { integratePopulationMoments, type PopulationMoments } from './populationMoments';
import { POPULATION_NODES, POPULATION_WEIGHTS } from './populationQuadrature';
import { companionMassDensity, COMPANIONS_AT_MINIMUM, FIELD_MASS_BREAKS, FIELD_OBJECTS_PER_SYSTEM } from './fieldMultiplicity';
import { fieldPopulationTable } from './fieldPopulationTable';

export function fieldPopulationMoments(component: StellarComponent): Readonly<PopulationMoments> {
  return fieldPopulationTable[component];
}

/** Full primary+companion ensemble per individual object. Marginalizing
 * companion masses is exact for additive mass/light moments; correlated
 * coeval ages matter only when selecting a system by its combined light. */
export function integrateFieldPopulation(component: StellarComponent, bins = 64): PopulationMoments {
  const result = integratePopulationMoments(component,bins,
    mass => (1+companionMassDensity(mass)/initialMassDensity(mass))/FIELD_OBJECTS_PER_SYSTEM,
    FIELD_MASS_BREAKS);
  const rgb = opticalRgbInterpolator();
  const optical = [...result.opticalRgbSolar] as [number,number,number];
  for (let i = 0; i < POPULATION_NODES.length; i++) for (const sign of [-1,1]) {
    const age = componentAgeForUnit(component,.5+sign*.5*POPULATION_NODES[i]);
    const star = evolve(.013,age);
    const weight = .5*POPULATION_WEIGHTS[i]*COMPANIONS_AT_MINIMUM/FIELD_OBJECTS_PER_SYSTEM;
    result.massSolar += weight*star.mass;
    result.luminositySolar += weight*star.luminosity;
    const color = rgb(star.tEff);
    for (let c = 0; c < 3; c++) optical[c] += weight*star.luminosity*color[c];
  }
  return {...result,opticalRgbSolar:optical};
}
