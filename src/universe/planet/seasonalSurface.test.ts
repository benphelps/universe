import { expect, it } from 'vitest';
import { AU, G, SOLAR_MASS } from '../../core/physics/constants';
import { mu } from '../../core/physics/units';
import { buildSeasonalCycle, seasonalPointCycle, seasonalPointTemperatureAt, type SeasonalClimateInput } from './seasonalClimate';
import { buildSeasonalSurface, seasonalSurfaceTemperatureAt } from './seasonalSurface';
const input: SeasonalClimateInput = {
  forcing:{sources:[{luminositySolar:1,path:[]}],origin:[],orbit:{mu:mu(G*SOLAR_MASS),elements:{semiMajorAxis:AU,eccentricity:0,inclination:0,longitudeOfAscendingNode:0,argumentOfPeriapsis:0,meanAnomalyAtEpoch:0,epoch:0}}},
  rotation:{periodHours:6,obliquityRad:1.5,locked:false,spinOrbitResonance:null},albedo:.3,opticalDepth:.8,internalWm2:.1,
  pressureBar:1,heatCapacityJm2K:20e6,referenceMeanK:270,
};
function cycle(tilt=1.5,eccentricity=0) {
  const recipe=structuredClone(input);recipe.rotation.obliquityRad=tilt;recipe.forcing.orbit.elements.eccentricity=eccentricity;
  const c=buildSeasonalCycle(recipe,{steps:eccentricity>.6?768:384});if(c.status!=='ready')throw Error(c.reason);return c.cycle;
}
it('measures full-cycle latitude error against off-grid converged point solutions',()=>{
  for(const [tilt,e] of [[0,0],[.4,.2],[1.5,0],[1.5,.7]]) {
    const c=cycle(tilt,e),result=buildSeasonalSurface(c);
    expect(result.status).toBe('ready');if(result.status!=='ready')continue;
    const field=result.field;
    expect(field.diagnostics.pointSolves).toBeLessThanOrEqual(513);
    expect(field.temperatureK.byteLength).toBeLessThanOrEqual(257*768*4);
    let worst=0;
    for(let j=0;j<83;j++) {
      const angle=(j+.317)*Math.PI/83,y=Math.cos(angle),point=seasonalPointCycle(c,{x:Math.sin(angle),y,z:0})!;
      for(let k=0;k<101;k++) {
        const seconds=c.cycleSeconds*(k+.413)/101;
        worst=Math.max(worst,Math.abs(seasonalSurfaceTemperatureAt(field,y,seconds)-seasonalPointTemperatureAt(point,seconds)));
      }
    }
    expect(worst).toBeLessThan(.4);
  }
});
it('keeps exact poles, continuous wrap and query-order independent seasons',()=>{
  const c=cycle(),r=buildSeasonalSurface(c);if(r.status!=='ready')throw Error(r.reason);
  for(const y of [-1,-.4,0,.7,1]) {
    const before=seasonalSurfaceTemperatureAt(r.field,y,0);
    expect(seasonalSurfaceTemperatureAt(r.field,y,c.cycleSeconds)).toBe(before);
    expect(seasonalSurfaceTemperatureAt(r.field,y,-c.cycleSeconds)).toBe(before);
    expect(Math.abs(seasonalSurfaceTemperatureAt(r.field,y,-1)-seasonalSurfaceTemperatureAt(r.field,y,1))).toBeLessThan(.001);
  }
  const north=seasonalPointCycle(c,{x:0,y:1,z:0})!;
  for(let k=0;k<20;k++) expect(seasonalSurfaceTemperatureAt(r.field,1,c.cycleSeconds*k/20)).toBeCloseTo(seasonalPointTemperatureAt(north,c.cycleSeconds*k/20),4);
});
it('fails closed for unresolved longitude or an exhausted resolution budget',()=>{
  const c=cycle();
  expect(buildSeasonalSurface({...c,mode:'spin-resolved'})).toEqual({status:'unavailable',reason:'spin-resolved'});
  expect(buildSeasonalSurface(c,{maxIntervals:16,toleranceK:1e-9})).toEqual({status:'unavailable',reason:'resolution-budget'});
  expect(()=>buildSeasonalSurface(c,{toleranceK:NaN})).toThrow(RangeError);
});
