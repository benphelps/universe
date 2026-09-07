import { expect, it } from 'vitest';
import { integrateOverviewPopulation, compressOverviewPopulation, overviewThinCount } from './overviewPopulation';
import { overviewPopulationTable as table } from './overviewPopulationTable';
import { fieldPopulationMoments } from './fieldPopulation';
import { getGalaxyParticles } from './particles';

it('funds the finite bright tail from the parent optical population',()=>{
  const points=getGalaxyParticles(), parent=fieldPopulationMoments('thin-disk').opticalRgbSolar;
  expect(overviewThinCount()).toBeCloseTo(table.parentCount,3);
  expect(points.count).toBe(8192);
  const sum=[0,0,0];
  for(let i=0;i<points.count;i++)for(let c=0;c<3;c++)sum[c]+=points.opticalRgb[i*3+c];
  for(let c=0;c<3;c++){
    expect(sum[c]).toBe(points.realizedRgb[c]);
    const remainder=table.parentCount*(parent[c]-points.selectedMeanRgb[c]);
    expect(remainder).toBeGreaterThan(0);
    expect(remainder+points.expectedRgb[c]).toBeCloseTo(table.parentCount*parent[c],3);
    expect(Math.abs(sum[c]/points.expectedRgb[c]-1)).toBeLessThan(.001);
  }
});
it('preserves the selected RGB moments when compressing the luminosity function',()=>{
  for(let c=0;c<3;c++){
    const power=table.bins.reduce((sum,row)=>sum+row[c]*table.count/table.bins.length,0);
    expect(Math.abs(power/table.expectedRgb[c]-1)).toBeLessThan(1e-9);
  }
  const node={initialMass:1,ageGyr:1,mass:1,bolometric:4};
  const compressed=compressOverviewPopulation({count:3,expectedRgb:[4,5,6],cutoffOptical:1,
    nodes:[{...node,count:1,opticalRgb:[2,3,4]},{...node,count:2,opticalRgb:[1,1,1]}]},2);
  expect(compressed[0]).toEqual([5/3,7/3,3]);expect(compressed[1]).toEqual([1,1,1]);
});
it('checks the generated bright tail against independently refined physical phases',()=>{
  const reference=integrateOverviewPopulation(1024,8);
  expect(reference.count).toBe(table.count);
  expect(Math.abs(reference.cutoffOptical/table.cutoffOptical-1)).toBeLessThan(.02);
  for(let c=0;c<3;c++)expect(Math.abs(reference.expectedRgb[c]/table.expectedRgb[c]-1)).toBeLessThan(.002);
},20000); // Offline 1024-bin refinement, like the other population integrals.
