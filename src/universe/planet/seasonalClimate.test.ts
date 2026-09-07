import { expect, it } from 'vitest';
import { AU, G, SIGMA_SB, SOLAR_LUMINOSITY, SOLAR_MASS } from '../../core/physics/constants';
import { mu } from '../../core/physics/units';
import { forcingPeriodSeconds } from './illumination';
import { buildSeasonalCycle, seasonalPointCycle, seasonalPointTemperatureAt, seasonalSupport, seasonalGridTemperatureAt, thermalStorageStep, type SeasonalClimateInput, type SeasonalCycle } from './seasonalClimate';

const input: SeasonalClimateInput = {
  forcing: { sources: [{luminositySolar:1,path:[]}], origin:[], orbit:{mu:mu(G*SOLAR_MASS), elements:{
    semiMajorAxis:AU,eccentricity:0,inclination:0,longitudeOfAscendingNode:0,argumentOfPeriapsis:0,meanAnomalyAtEpoch:0,epoch:0}}},
  rotation:{periodHours:24,obliquityRad:0.4,locked:false,spinOrbitResonance:null},
  albedo:0.3,opticalDepth:0.8,internalWm2:0.09,pressureBar:1,heatCapacityJm2K:42e6,referenceMeanK:288,
};
function cycle(i = input, steps = 192, latitudeCount = 12): SeasonalCycle {
  const result = buildSeasonalCycle(i, {steps, latitudeCount});
  expect(result.status).toBe('ready');
  if(result.status !== 'ready') throw Error(result.reason);
  return result.cycle;
}

it('closes sensible heat storage against radiation and converges to independent analytic cooling', () => {
  const emit = SIGMA_SB / 1.6, capacity = 2e6, duration = 1e6, t0 = 300;
  const exact = t0 / (1 + 3 * emit * t0 ** 3 * duration / capacity) ** (1/3);
  let coarse = t0, fine = t0;
  for(let k=0;k<1000;k++) {
    const next=thermalStorageStep(fine,0,duration/1000/capacity,emit);
    expect(Math.abs(capacity*(next-fine)/(duration/1000)+emit*next**4)).toBeLessThan(1e-7);
    fine=next;
    if(k<100) coarse=thermalStorageStep(coarse,0,duration/100/capacity,emit);
  }
  expect(Math.abs(fine-exact)).toBeLessThan(Math.abs(coarse-exact)*0.12);
  expect(Math.abs(fine-exact)).toBeLessThan(0.04);
});

it('recovers the independent small-signal amplitude and thermal phase lag', () => {
  const t0=288, emit=SIGMA_SB/1.6, capacity=2e6, period=1e6, omega=2*Math.PI/period;
  const lambda=4*emit*t0**3, amplitude=1, dt=period/2048, lag=Math.atan(omega*capacity/lambda);
  let t=t0, maximumError=0;
  for(let k=0;k<2048*12;k++) {
    t=thermalStorageStep(t,emit*t0**4+amplitude*Math.cos(omega*(k+.5)*dt),dt/capacity,emit);
    if(k>=2048*11) {
      const analytic=t0+amplitude/Math.hypot(lambda,omega*capacity)*Math.cos(omega*(k+1)*dt-lag);
      maximumError=Math.max(maximumError,Math.abs(t-analytic));
    }
  }
  expect(maximumError).toBeLessThan(0.0003);
});

it('closes the eccentric annual energy ledger, including internal heat and the periodic storage boundary', () => {
  for(const e of [0,0.4,0.75]) {
    const f={...input.forcing,orbit:{...input.forcing.orbit,elements:{...input.forcing.orbit.elements,eccentricity:e}}};
    const c=cycle({...input,forcing:f},e>0.6?768:192);
    const independent=SOLAR_LUMINOSITY*(1-input.albedo)/(16*Math.PI*AU**2*Math.sqrt(1-e*e));
    expect(c.diagnostics.absorbedWm2/independent).toBeCloseTo(1,10);
    expect(Math.abs(c.diagnostics.energyResidualWm2)).toBeLessThan(1e-7);
    expect(c.diagnostics.maxStepResidualWm2).toBeLessThan(1e-7);
    expect(Math.abs(c.diagnostics.storageWm2)).toBeLessThan(1e-4);
    expect(c.diagnostics.maxSeamK).toBeLessThan(1e-5);
  }
});

it('resolves high-obliquity seasons and damps their amplitude with a deeper heat reservoir', () => {
  const tilt={...input.rotation,periodHours:6,obliquityRad:Math.PI/2};
  const a=cycle({...input,rotation:tilt,heatCapacityJm2K:2e6});
  const b=cycle({...input,rotation:tilt,heatCapacityJm2K:80e6});
  const range=(c:SeasonalCycle)=>{
    const ts=Array.from({length:192},(_,k)=>seasonalGridTemperatureAt(c,{x:0,y:1,z:0},c.cycleSeconds*k/192));
    return Math.max(...ts)-Math.min(...ts);
  };
  expect(range(a)).toBeGreaterThan(50);
  expect(range(b)).toBeLessThan(range(a)*0.5);
  const c=cycle({...input,rotation:{...input.rotation,obliquityRad:0}});
  expect(range(c)).toBeLessThan(1e-4);
});

it('is independent of time-query order and continuous through cycle, longitude and polar seams', () => {
  const year=forcingPeriodSeconds(input.forcing);
  const c=cycle({...input,rotation:{...input.rotation,periodHours:year/3600,locked:true,obliquityRad:0}});
  expect(c.mode).toBe('spin-resolved');
  // The star is exactly on the pole's horizon, so only redistributed
  // stellar power and internal heat remain. A ring average fails this.
  const polarPower=-Math.expm1(-input.pressureBar)*(1-input.albedo)*SOLAR_LUMINOSITY/(16*Math.PI*AU**2)+input.internalWm2;
  expect(seasonalGridTemperatureAt(c,{x:0,y:1,z:0},0)).toBeCloseTo((polarPower*(1+.75*input.opticalDepth)/SIGMA_SB)**.25,3);
  const dir={x:-1,y:0,z:0};
  const first=seasonalGridTemperatureAt(c,dir,year*.32);
  for(const t of [-100*year,0,1e9,year*.9]) expect(seasonalGridTemperatureAt(c,dir,t)).toBeGreaterThan(0);
  expect(seasonalGridTemperatureAt(c,dir,year*.32)).toBe(first);
  expect(seasonalGridTemperatureAt(c,dir,-year*.68)).toBeCloseTo(first,8);
  expect(seasonalGridTemperatureAt(c,dir,year+1e-4)).toBeCloseTo(seasonalGridTemperatureAt(c,dir,-1e-4),6);
  expect(seasonalGridTemperatureAt(c,{x:1,y:0,z:1e-10},0)).toBeCloseTo(seasonalGridTemperatureAt(c,{x:1,y:0,z:-1e-10},0),6);
  expect(seasonalGridTemperatureAt(c,{x:1e-10,y:1,z:0},0)).toBeCloseTo(seasonalGridTemperatureAt(c,{x:-1e-10,y:1,z:0},0),6);
});

it('measures time refinement and keeps arbitrary nonperiodic forcing out of a repeated annual cache', () => {
  const a=cycle(),b=cycle(input,384);
  let error=0;
  for(let k=0;k<100;k++) for(const y of [-1,0,1]) {
    const dir={x:Math.sqrt(1-y*y),y,z:0};
    error=Math.max(error,Math.abs(seasonalGridTemperatureAt(a,dir,a.cycleSeconds*k/100)-seasonalGridTemperatureAt(b,dir,b.cycleSeconds*k/100)));
  }
  expect(error).toBeLessThan(0.15);
  expect(seasonalSupport({...input,forcing:{...input.forcing,sources:[...input.forcing.sources,...input.forcing.sources]}})).toBe('multiple-periods');
  expect(seasonalSupport({...input,forcing:{...input.forcing,satellite:input.forcing.orbit}})).toBe('multiple-periods');
  expect(seasonalSupport({...input,rotation:{...input.rotation,periodHours:2000}})).toBe('slow-rotation');
  expect(seasonalSupport({...input,pressureBar:90})).toBe('extreme-regime');
  expect(seasonalSupport({...input,forcing:{...input.forcing,orbit:{...input.forcing.orbit,elements:{...input.forcing.orbit.elements,inclination:NaN}}}})).toBe('extreme-regime');
  const year=forcingPeriodSeconds(input.forcing);
  const resonance=cycle({...input,rotation:{...input.rotation,periodHours:year/3600*2/3,spinOrbitResonance:'3:2'}});
  expect(resonance.cycleSeconds).toBeCloseTo(year*2,6);
});

it('keeps inspected points accurate across a sharp synchronous terminator, independently of the display grid',()=>{
  const year=forcingPeriodSeconds(input.forcing);
  const recipe={...input,pressureBar:1e-5,rotation:{...input.rotation,locked:true,obliquityRad:0,periodHours:year/3600}};
  const coarse=cycle(recipe),fine=cycle(recipe,192,24),flux=SOLAR_LUMINOSITY/(4*Math.PI*AU**2),transport=-Math.expm1(-recipe.pressureBar);
  for(const x of [-1,-.001,0,.001,1]){
    const dir={x,y:0,z:Math.sqrt(1-x*x)},a=seasonalPointCycle(coarse,dir)!,b=seasonalPointCycle(fine,dir)!;
    const power=(1-input.albedo)*flux*((1-transport)*Math.max(0,-x)+transport/4)+input.internalWm2;
    const expected=(power*(1+.75*input.opticalDepth)/SIGMA_SB)**.25;
    expect(seasonalPointTemperatureAt(a,year*.7)).toBeCloseTo(expected,6);
    expect(a.temperatureK).toEqual(b.temperatureK);
  }
});
