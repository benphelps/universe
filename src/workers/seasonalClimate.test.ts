import { afterEach, expect, it, vi } from 'vitest';
import { AU, G, SOLAR_MASS } from '../core/physics/constants';
import { mu } from '../core/physics/units';
import type { SeasonalClimateInput, SeasonalCycle, SeasonalResult } from '../universe/planet/seasonalClimate';
import { GenerationScheduler } from '../app/generationScheduler';
import * as scheduling from '../app/generationScheduler';
import { SeasonalClimateCache } from './seasonalClimate';

class FakeWorker {
  static instances: FakeWorker[]=[];
  onmessage?: (event:{data:SeasonalResult})=>void;
  onerror?: ()=>void; onmessageerror?: ()=>void;
  terminate=vi.fn(); postMessage=vi.fn();
  constructor(){FakeWorker.instances.push(this);}
}
const input:SeasonalClimateInput={forcing:{sources:[{luminositySolar:1,path:[]}],origin:[],orbit:{mu:mu(G*SOLAR_MASS),elements:{
  semiMajorAxis:AU,eccentricity:0,inclination:0,longitudeOfAscendingNode:0,argumentOfPeriapsis:0,meanAnomalyAtEpoch:0,epoch:0}}},
  rotation:{periodHours:6,obliquityRad:.4,locked:false,spinOrbitResonance:null},albedo:.3,opticalDepth:.8,internalWm2:.09,
  pressureBar:1,referenceMeanK:288,heatCapacityJm2K:42e6};
const result=(bytes=48):SeasonalResult=>({status:'ready',cycle:{temperatureK:new Float32Array(bytes/4),forcingSamples:new Float64Array(0)} as SeasonalCycle});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();FakeWorker.instances=[];});

it('transfers the physical recipe, releases its worker, and reuses only matching physical inputs',()=>{
  vi.stubGlobal('Worker',FakeWorker);const cache=new SeasonalClimateCache(),ready=vi.fn();
  cache.request(input,ready);const first=FakeWorker.instances[0],cycle=result();
  expect(first.postMessage).toHaveBeenCalledWith(input);first.onmessage!({data:cycle});
  expect(first.terminate).toHaveBeenCalledOnce();expect(ready).toHaveBeenCalledExactlyOnceWith(cycle);
  cache.request(input,ready);expect(FakeWorker.instances).toHaveLength(1);expect(ready).toHaveBeenCalledTimes(2);
  const changed={...input,forcing:{...input.forcing,sources:[{luminositySolar:2,path:[]}]}};
  const cancel=cache.request(changed,ready);expect(FakeWorker.instances).toHaveLength(2);cancel();
});

it('cancels queued and active work, ignores stale arrivals, and releases permits after termination',()=>{
  vi.stubGlobal('Worker',FakeWorker);const scheduler=new GenerationScheduler(1);
  vi.spyOn(scheduling,'scheduleGeneration').mockImplementation((priority,start)=>scheduler.schedule(priority,start));
  let release!:()=>void;scheduler.schedule('visible-terrain',r=>{release=r;});
  const cache=new SeasonalClimateCache(),ready=vi.fn(),cancelQueued=cache.request(input,ready);
  expect(FakeWorker.instances).toHaveLength(0);expect(scheduler.queuedCount).toBe(1);
  cancelQueued();release();expect(scheduler.queuedCount).toBe(0);
  const cancel=cache.request(input,ready),worker=FakeWorker.instances[0];
  worker.terminate.mockImplementation(()=>expect(scheduler.activeCount).toBe(1));
  cancel();cancel();worker.onmessage!({data:result()});worker.onerror!();
  expect(worker.terminate).toHaveBeenCalledOnce();expect(ready).not.toHaveBeenCalled();
  expect(scheduler.activeCount).toBe(0);expect(cache.size).toBe(0);
});

it('bounds both cache bytes and entries with LRU eviction',()=>{
  vi.stubGlobal('Worker',FakeWorker);const cache=new SeasonalClimateCache(100,2),ready=vi.fn();
  const add=(albedo:number,bytes=48)=>{cache.request({...input,albedo},ready);FakeWorker.instances.at(-1)!.onmessage!({data:result(bytes)});};
  add(.2);add(.3);expect(cache.size).toBe(2);expect(cache.retainedBytes).toBe(96);
  cache.request({...input,albedo:.2},ready);add(.4);
  expect(cache.size).toBe(2);expect(cache.retainedBytes).toBe(96);
  const before=FakeWorker.instances.length,cancel=cache.request({...input,albedo:.3},ready);
  expect(FakeWorker.instances).toHaveLength(before+1);cancel();
  add(.5,104);expect(cache.retainedBytes).toBe(96);expect(cache.size).toBe(2);
});

it('handles worker failures and unsupported forcing without caching a transient failure',()=>{
  vi.stubGlobal('Worker',FakeWorker);const cache=new SeasonalClimateCache(),ready=vi.fn();
  cache.request(input,ready);const worker=FakeWorker.instances[0];worker.onerror!();worker.onmessage!({data:result()});
  expect(ready).toHaveBeenCalledExactlyOnceWith({status:'unavailable',reason:'worker-failed'});expect(cache.size).toBe(0);
  vi.stubGlobal('Worker',undefined);cache.request(input,ready);
  expect(ready).toHaveBeenCalledTimes(2);
  cache.request({...input,pressureBar:100},ready);
  expect(ready).toHaveBeenLastCalledWith({status:'unavailable',reason:'extreme-regime'});
});

it('counts transferred annual mean arrays in the same bounded cache',()=>{
  vi.stubGlobal('Worker',FakeWorker);const cache=new SeasonalClimateCache(100,4),ready=vi.fn();
  const withMean=result(48);if(withMean.status!=='ready')throw Error();
  withMean.cycle.annualMean={status:'ready',field:{angles:new Float64Array(2),ratios:new Float64Array(2),fourthK4:new Float64Array(2)} as import('../universe/planet/annualMean').AnnualMeanField};
  cache.request(input,ready);FakeWorker.instances[0].onmessage!({data:withMean});
  expect(cache.retainedBytes).toBe(96);
  cache.request({...input,albedo:.2},ready);FakeWorker.instances[1].onmessage!({data:result(48)});
  expect(cache.size).toBe(1);expect(cache.retainedBytes).toBe(48);
});

it('includes seasonal visual fields in the same retained-byte budget',()=>{
  vi.stubGlobal('Worker',FakeWorker);const cache=new SeasonalClimateCache(100,4),ready=vi.fn();
  const visual=result(48);if(visual.status!=='ready')throw Error();
  visual.cycle.surface={status:'ready',field:{temperatureK:new Float32Array(12)} as import('../universe/planet/seasonalSurface').SeasonalSurfaceField};
  cache.request(input,ready);FakeWorker.instances[0].onmessage!({data:visual});expect(cache.retainedBytes).toBe(96);
  cache.request({...input,albedo:.2},ready);FakeWorker.instances[1].onmessage!({data:result(48)});
  expect(cache.size).toBe(1);expect(cache.retainedBytes).toBe(48);
});
