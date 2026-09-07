import { expect, it } from 'vitest';
import { generateSystem } from '../system/generate';
import { prepareAnnualMean, supportsAnnualMean } from './annualMeanPreparation';
import { buildAnnualMeanField } from './annualMean';
import { buildSeasonalCycle, seasonalClimateInput, seasonalPointCycle, seasonalPointTemperatureAt } from './seasonalClimate';
import { createSurfaceField } from '../surface/field';
import { localSurfaceTemperatureK } from '../surface/params';

it('shares an immutable climate recipe between bake, main field and terrain workers before geometry begins', () => {
  const physical=generateSystem(0xd50464b00652fab0n).planets[6].physical,original=structuredClone(physical);
  const input=seasonalClimateInput(physical);if(typeof input==='string')throw Error(input);
  expect(supportsAnnualMean(input)).toBe(true);
  const cycle=buildSeasonalCycle(input);if(cycle.status!=='ready')throw Error(cycle.reason);
  const focused=buildAnnualMeanField(cycle.cycle),baked=prepareAnnualMean(physical);
  expect(focused.status).toBe('ready');if(focused.status!=='ready')return;
  expect(baked).toEqual(focused.field);
  const main=createSurfaceField(physical.seedHex,physical,{deferGrid:true,annualMean:focused.field});
  const worker=createSurfaceField(physical.seedHex,structuredClone(physical),{deferGrid:true,annualMean:structuredClone(baked)});
  const normal={x:Math.sqrt(.75),y:.5,z:0};
  const height=main.heightAt(normal);
  expect(worker.heightAt(normal)).toBe(height);
  expect(localSurfaceTemperatureK(main.params,normal,height)).toBe(localSurfaceTemperatureK(worker.params,normal,height));
  expect(main.params.temperatureField?.expectedMeanOutgoingWm2).toBe(physical.climate.surfaceField?.expectedMeanOutgoingWm2);
  expect(main.params.temperatureField?.meanK).toBe(focused.field.meanK);
  const point=seasonalPointCycle(cycle.cycle,normal)!;
  for(const time of [1e15,-1e12,0,800000])seasonalPointTemperatureAt(point,time);
  expect(main.heightAt(normal)).toBe(height);expect(physical).toEqual(original);
});
it('leaves unsupported and molten regimes on the same deterministic reference in every consumer', () => {
  const system=generateSystem(0xd50464b00652fab0n);
  const locked=system.planets[4].physical,slow=system.planets[5].physical;
  expect(prepareAnnualMean(locked)).toBeUndefined();expect(prepareAnnualMean(slow)).toBeUndefined();
  const molten=structuredClone(system.planets[6].physical);molten.climate.hydrosphere='magma';
  expect(prepareAnnualMean(molten)).toBeUndefined();
});
