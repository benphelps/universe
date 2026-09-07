import {describe,it,expect} from 'vitest';
import {companionMassDensity,COMPANIONS_AT_MINIMUM,FIELD_OBJECTS_PER_SYSTEM} from './fieldMultiplicity';
import {fieldPopulationMoments,integrateFieldPopulation} from './fieldPopulation';
import {initialMassFromUnit,initialMassDensity} from '../star/imf';
import {multiplicityFraction} from '../star/multiplicity';

describe('field primary and companion inventory',()=>{
  it('normalizes the component mass distribution including the clamp atom',()=>{
    let companions=COMPANIONS_AT_MINIMUM,expected=0;
    const n=100000;
    for(let i=0;i<n;i++) {
      const mass=initialMassFromUnit((i+.5)/n);
      companions+=companionMassDensity(mass)/initialMassDensity(mass)/n;
      expected+=1.25*multiplicityFraction(mass)/n;
    }
    expect(companions).toBeCloseTo(expected,5);
    expect(1+companions).toBeCloseTo(FIELD_OBJECTS_PER_SYSTEM,6);
  });
  it('retains independently integrated mass and optical moments',()=>{
    for(const component of ['thin-disk','thick-disk','halo','bulge'] as const) {
      const direct=integrateFieldPopulation(component,32),table=fieldPopulationMoments(component);
      expect(direct.massSolar/table.massSolar).toBeCloseTo(1,7);
      expect(direct.luminositySolar/table.luminositySolar).toBeCloseTo(1,6);
      for(let c=0;c<3;c++)expect(direct.opticalRgbSolar[c]/table.opticalRgbSolar[c]).toBeCloseTo(1,6);
    }
  },15000);
});
