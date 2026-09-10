import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { accretionFlowFor } from '../universe/galaxy/accretionFlow';
import { GenerationScheduler } from '../app/generationScheduler';

const env=vi.hoisted(()=>({schedule:vi.fn()}));
vi.mock('../app/generationScheduler',async original=>({...await original<typeof import('../app/generationScheduler')>(),scheduleGeneration:env.schedule}));
class FakeWorker {
  static all:FakeWorker[]=[];
  onmessage:((event:MessageEvent)=>void)|null=null;
  onerror:(()=>void)|null=null;
  onmessageerror:(()=>void)|null=null;
  terminate=vi.fn();postMessage=vi.fn();
  constructor(){FakeWorker.all.push(this);}
  reply(data:unknown){this.onmessage?.({data} as MessageEvent);}
}
let scheduler:GenerationScheduler;
beforeEach(()=>{vi.resetModules();FakeWorker.all=[];vi.stubGlobal('Worker',FakeWorker);scheduler=new GenerationScheduler(1);env.schedule.mockImplementation(scheduler.schedule.bind(scheduler));});
afterEach(()=>{vi.unstubAllGlobals();});
const callbacks=()=>({ready:vi.fn(),progress:vi.fn(),failed:vi.fn()});
const flow=accretionFlowFor(321000,.89,1e-5);
it('respects shared permits and releases them when active or queued generation is cancelled',async()=>{
  const {requestBlackHoleTables}=await import('./blackHole');
  const a=callbacks(),b=callbacks();
  const stopA=requestBlackHoleTables(flow,1000,a),stopB=requestBlackHoleTables(flow,2000,b);
  expect(FakeWorker.all).toHaveLength(1);expect(scheduler.queuedCount).toBe(1);
  stopB();expect(scheduler.queuedCount).toBe(0);
  stopA();expect(FakeWorker.all[0].terminate).toHaveBeenCalledOnce();expect(scheduler.activeCount).toBe(0);
  FakeWorker.all[0].reply({type:'ready',data:{}});expect(a.ready).not.toHaveBeenCalled();expect(b.ready).not.toHaveBeenCalled();
});
it('delivers progress and completed data, reuses the bounded cache asynchronously, and can cancel a cache hit',async()=>{
  const {requestBlackHoleTables}=await import('./blackHole');const a=callbacks();
  requestBlackHoleTables(flow,1000,a);
  FakeWorker.all[0].reply({type:'progress',progress:{fraction:.4,stage:'plasma spectra'}});
  expect(a.progress).toHaveBeenLastCalledWith({fraction:.4,stage:'plasma spectra'});
  const data={};FakeWorker.all[0].reply({type:'ready',data});
  expect(a.ready).toHaveBeenCalledWith(data);expect(scheduler.activeCount).toBe(0);
  const b=callbacks(),c=callbacks();requestBlackHoleTables(flow,1000,b);
  expect(b.ready).not.toHaveBeenCalled();const stop=requestBlackHoleTables(flow,1000,c);stop();
  await Promise.resolve();expect(b.ready).toHaveBeenCalledWith(data);expect(c.ready).not.toHaveBeenCalled();expect(FakeWorker.all).toHaveLength(1);
});
it('reports a worker failure without blocking fallback work and starts the next queued job',async()=>{
  const {requestBlackHoleTables}=await import('./blackHole');const a=callbacks(),b=callbacks();
  requestBlackHoleTables(flow,1000,a);const cancel=requestBlackHoleTables(flow,2000,b);
  FakeWorker.all[0].onerror?.();expect(a.failed).toHaveBeenCalledOnce();expect(a.ready).not.toHaveBeenCalled();
  expect(FakeWorker.all).toHaveLength(2);expect(scheduler.activeCount).toBe(1);
  cancel();expect(scheduler.activeCount).toBe(0);
});
it('handles worker construction failure without leaking a permit',async()=>{
  vi.stubGlobal('Worker',class {constructor(){throw Error('unavailable');}});
  const {requestBlackHoleTables}=await import('./blackHole');const a=callbacks();
  requestBlackHoleTables(flow,1000,a);expect(a.failed).toHaveBeenCalledWith('unavailable');expect(scheduler.activeCount).toBe(0);
});
