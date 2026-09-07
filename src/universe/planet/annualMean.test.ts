import { expect, it } from 'vitest';
import { AU, G, SIGMA_SB, SOLAR_LUMINOSITY, SOLAR_MASS } from '../../core/physics/constants';
import { mu } from '../../core/physics/units';
import { buildAnnualMeanField, annualMeanTemperatureAt } from './annualMean';
import { buildSeasonalCycle, seasonalPointCycle, type SeasonalClimateInput } from './seasonalClimate';
import { forcingPeriodSeconds } from './illumination';

const input: SeasonalClimateInput = {
  forcing: { sources: [{luminositySolar:1,path:[]}], origin:[], orbit:{mu:mu(G*SOLAR_MASS), elements:{
    semiMajorAxis:AU,eccentricity:0,inclination:0,longitudeOfAscendingNode:0,argumentOfPeriapsis:0,meanAnomalyAtEpoch:0,epoch:0}}},
  rotation:{periodHours:6,obliquityRad:0,locked:false,spinOrbitResonance:null},
  albedo:0.3,opticalDepth:0.8,internalWm2:0.1,pressureBar:1e-5,heatCapacityJm2K:2e6,referenceMeanK:270,
};
function cycle(recipe = input, steps = 384) {
  const result = buildSeasonalCycle(recipe,{latitudeCount:2,steps});
  if(result.status !== 'ready') throw Error(result.reason); return result.cycle;
}
function mean(recipe = input) {
  const result = buildAnnualMeanField(cycle(recipe));
  if(result.status !== 'ready') throw Error(result.reason); return result.field;
}
it('preserves stationary analytic equilibrium and the actual cold polar horizon', () => {
  const field=mean(),flux=SOLAR_LUMINOSITY/(4*Math.PI*AU**2),transport=-Math.expm1(-input.pressureBar);
  for(let k=0;k<=200;k++) {
    const theta=k*Math.PI/200,dir={x:Math.sin(theta),y:Math.cos(theta),z:0};
    const power=(1-input.albedo)*flux*((1-transport)*Math.sin(theta)/Math.PI+transport/4)+input.internalWm2;
    expect(Math.abs(annualMeanTemperatureAt(field,dir)-(power*1.6/SIGMA_SB)**.25)).toBeLessThan(.23);
  }
  expect(Math.max(...field.ratios)-Math.min(...field.ratios)).toBeLessThan(1e-10);
});
it('refines the full mean lookup against independent points and a finer time solution', () => {
  for(const e of [0,.4,.8]) {
    const recipe=structuredClone(input);recipe.rotation.obliquityRad=1.5;recipe.forcing.orbit.elements.eccentricity=e;
    const c=cycle(recipe,e>.6?768:384),fine=cycle(recipe,e>.6?3072:1536),result=buildAnnualMeanField(c);
    expect(result.status).toBe('ready');if(result.status!=='ready')continue;
    const field=result.field;
    expect(field.diagnostics.pointSolves).toBeLessThanOrEqual(513);
    expect(Math.max(...field.ratios)).toBeLessThanOrEqual(1);expect(Math.min(...field.ratios)).toBeGreaterThan(0);
    for(let k=0;k<100;k++) {
      const theta=(k+.37)*Math.PI/100,dir={x:Math.sin(theta),y:Math.cos(theta),z:0};
      const direct=seasonalPointCycle(c,dir)!.temperatureK,refined=seasonalPointCycle(fine,dir)!.temperatureK;
      const average=(ts:Float64Array)=>ts.reduce((s,t)=>s+t/ts.length,0);
      expect(Math.abs(annualMeanTemperatureAt(field,dir)-average(direct))).toBeLessThan(.25);
      expect(Math.abs(annualMeanTemperatureAt(field,dir)-average(refined))).toBeLessThan(.8);
      expect(annualMeanTemperatureAt(field,{x:0,y:dir.y,z:dir.x})).toBe(annualMeanTemperatureAt(field,dir));
    }
  }
});
it('returns a complete immutable cloneable recipe or an explicit bounded fallback', () => {
  const c=cycle(),before=c.forcingSamples.slice();
  expect(buildAnnualMeanField(c,{maxPointSolves:1})).toEqual({status:'unavailable',reason:'resolution-budget'});
  expect(c.forcingSamples).toEqual(before);
  const field=mean(),copy=structuredClone(field);
  expect(annualMeanTemperatureAt(copy,{x:1,y:0,z:0})).toBe(annualMeanTemperatureAt(field,{x:1,y:0,z:0}));
  expect(()=>buildAnnualMeanField(c,{toleranceK:NaN})).toThrow(RangeError);
  const locked={...input,rotation:{...input.rotation,locked:true,periodHours:forcingPeriodSeconds(input.forcing)/3600}};
  expect(buildAnnualMeanField(cycle(locked))).toEqual({status:'unavailable',reason:'spin-resolved'});
});
