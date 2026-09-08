import { beforeEach,expect,it,vi } from 'vitest';
import { Mesh,WebGLCubeRenderTarget } from 'three';
import { accretionFlowFor } from '../../universe/galaxy/accretionFlow';
import type { BlackHoleTableCallbacks } from '../../workers/blackHole';
import { StreamingBlackHoleObject } from './streamingBlackHoleObject';
const mocks=vi.hoisted(()=>({created:[] as Array<{model:any;prepared:any;mesh:Mesh;dispose:ReturnType<typeof vi.fn>;sky:any}>}));
vi.mock('./blackHoleObject',async()=>{
  const {Mesh}=await import('three');
  return {BlackHoleObject:class {
    mesh=new Mesh();kmPerRg=1;spinAxisScene=null;plasmaStatus=null;sky=null;dispose=vi.fn();
    constructor(public model:any,_frame:any,_solver:any,_sampling:any,public prepared:any){mocks.created.push(this);}
    prepare(fn:(mesh:Mesh)=>Promise<unknown>){return fn(this.mesh);}
    update(){this.mesh.visible=true;}render(){}
  }};
});
beforeEach(()=>{mocks.created.length=0;});
function fixture(){
  let callbacks!:BlackHoleTableCallbacks;
  const cancel=vi.fn(),request=vi.fn((_flow,_rg,cb)=>{callbacks=cb;return cancel;});
  const hole=new StreamingBlackHoleObject({spin:.89,gravitationalRadiusM:1000,spinAxis:[0,1,0],flow:accretionFlowFor(321000,.89,1e-5)},new Float32Array(9),'regular','atlas',request);
  return {hole,cancel,get callbacks(){return callbacks;}};
}
it('immediately shows a flow-free preview, then keeps scene and sky ownership stable while installing prepared data',async()=>{
  const f=fixture(),identity=f.hole.mesh,sky=new WebGLCubeRenderTarget(1);f.hole.sky=sky;
  expect(mocks.created[0].model.flow.eddingtonRatio).toBe(0);expect(f.hole.generation.pending).toBe(true);
  f.callbacks.progress({fraction:.5,stage:'plasma spectra'});expect(f.hole.generation.fraction).toBe(.5);
  const data={};f.callbacks.ready(data);expect(await f.hole.ready).toBe(true);
  expect(f.hole.mesh).toBe(identity);expect(mocks.created[1].prepared).toBe(data);expect(mocks.created[1].sky).toBe(sky);
  expect(mocks.created[0].dispose).toHaveBeenCalledOnce();expect(f.hole.generation.pending).toBe(false);
  f.hole.dispose();await Promise.resolve();expect(mocks.created[1].dispose).toHaveBeenCalledOnce();sky.dispose();
});
it('cancels a departed view and ignores late progress and worker results',async()=>{
  const f=fixture();f.hole.dispose();f.callbacks.progress({fraction:.8,stage:'jet spectra'});f.callbacks.ready({});
  expect(await f.hole.ready).toBe(false);expect(f.cancel).toHaveBeenCalledOnce();expect(mocks.created).toHaveLength(1);
  expect(f.hole.mesh.children).toHaveLength(0);
});
it('keeps shader resources alive until compilation settles, then discards a cancelled candidate',async()=>{
  const f=fixture();let finish!:()=>void;
  const wait=new Promise<void>(resolve=>{finish=resolve;});f.hole.prepare(()=>wait);
  f.callbacks.ready({});f.hole.dispose();expect(mocks.created.every(object=>object.dispose.mock.calls.length===0)).toBe(true);
  finish();await wait;await Promise.resolve();await Promise.resolve();await Promise.resolve();
  expect(mocks.created.every(object=>object.dispose.mock.calls.length===1)).toBe(true);expect(await f.hole.ready).toBe(false);
});
it('keeps the preview and exposes an error if generation fails',async()=>{
  const f=fixture();f.callbacks.failed('worker failed');expect(await f.hole.ready).toBe(false);
  expect(f.hole.generation.error).toBe('worker failed');expect(mocks.created).toHaveLength(1);f.hole.dispose();
});
