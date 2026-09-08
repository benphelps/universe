import { expect, it, vi } from 'vitest';
import { Color, CubeCamera, Mesh, PerspectiveCamera, Scene, ShaderMaterial, Vector4, WebGLCoordinateSystem, WebGLCubeRenderTarget, WebGLRenderTarget, type Object3D, type WebGLRenderer } from 'three';
import { NuclearCluster } from './nuclearCluster';
import { CAMERA_INSTRUMENT, EYE_INSTRUMENT, NARROWBAND_INSTRUMENT } from '../../universe/galaxy/displayLaw';
import type { ClusterStars, NuclearLightBudget } from '../../universe/galaxy/clusterStars';
import { nuclearColumnTable } from '../../universe/galaxy/nuclearProfile';

const origin = { xPc: 0, yPc: 0, zPc: 0 }, identity = new Float32Array([1,0,0,0,1,0,0,0,1]);
const sample = { positionsPc: new Float32Array([1,0,0, -1,0,0]), colors: new Float32Array([1,1,1, 1,1,1]),
  luminosities: new Float32Array([10,10]), opticalLuminosities: new Float32Array([4,2]), epochIndices: new Uint8Array([0,1]),
  column: nuclearColumnTable(), epochs: [4,2].map(resolved => ({resolvedOpticalRgb:[resolved,resolved,resolved],
    unresolvedOpticalRgb:[10-resolved,10-resolved,10-resolved], totalOpticalRgb:[10,10,10]} as NuclearLightBudget)),
} as ClusterStars;
const flush = async () => { for(let i=0;i<10;i++) await Promise.resolve(); };
function fixture() {
  let deliver!: (stars: ClusterStars) => void;
  const ready = vi.fn(), cancel = vi.fn();
  const cluster = new NuclearCluster(origin, identity, 1, ready, cb => { deliver=cb; return cancel; });
  const composite = cluster.group.children[0] as Mesh;
  return {cluster, composite, material:composite.material as ShaderMaterial, ready, cancel, deliver};
}
function renderFixture(cluster: NuclearCluster, camera = new PerspectiveCamera(45, 1, .01, 1e8)) {
  camera.position.z=3; camera.updateMatrixWorld(); cluster.group.updateMatrixWorld(true);
  const state = {target:new WebGLRenderTarget(64,64), face:3, level:2, viewport:new Vector4(4,8,2048,2048),
    scissor:new Vector4(1,2,30,40), scissorTest:false, color:new Color(.2,.3,.4), alpha:.4};
  const initial = {...state, viewport:state.viewport.clone(), scissor:state.scissor.clone(), color:state.color.clone()};
  state.target.viewport.copy(state.viewport);state.target.scissor.copy(state.scissor);state.target.scissorTest=state.scissorTest;
  const renderer = {
    autoClear:true, extensions:{get:vi.fn(()=>({}))},
    getCurrentViewport:(v:Vector4)=>v.copy(state.viewport), getRenderTarget:()=>state.target,
    getActiveCubeFace:()=>state.face, getActiveMipmapLevel:()=>state.level,
    getClearAlpha:()=>state.alpha, getScissorTest:()=>state.scissorTest,
    getClearColor:(c:Color)=>c.copy(state.color), getScissor:(v:Vector4)=>v.copy(state.scissor),
    setRenderTarget:(target:WebGLRenderTarget,face=0,level=0)=>{
      Object.assign(state,{target,face,level,scissorTest:target.scissorTest});
      state.viewport.copy(target.viewport);state.scissor.copy(target.scissor);
    },
    // These alter default framebuffer state and scale by DPR. A target
    // prepass must leave them alone, using its own physical viewport.
    setViewport:vi.fn(()=>{throw new Error('global viewport mutation');}),
    setScissor:vi.fn(()=>{throw new Error('global scissor mutation');}),
    setScissorTest:vi.fn(()=>{throw new Error('global scissor mutation');}),
    setClearColor:(value:Color|number,alpha:number)=>{state.color.set(value);state.alpha=alpha;},
    clear:vi.fn(), render:vi.fn(),
  };
  const composite=cluster.group.children[0] as Mesh;
  const render=()=>composite.onBeforeRender(renderer as unknown as WebGLRenderer,new Scene(),camera,composite.geometry,composite.material as ShaderMaterial,null!);
  return {camera,renderer,state,initial,render};
}
it('retains individual surrounding stars on every black-hole sky cube face', () => {
  const {cluster,deliver}=fixture();deliver(sample);
  const target=new WebGLCubeRenderTarget(1024);
  const cube=new CubeCamera(.01,1e8,target);
  cube.coordinateSystem=WebGLCoordinateSystem;cube.updateCoordinateSystem();
  for(const face of cube.children as PerspectiveCamera[]) {
    const {camera,initial,render}=renderFixture(cluster,face);
    camera.position.set(0,0,0);camera.updateMatrixWorld();render();
    expect(camera.projectionMatrix.elements[0]).toBeLessThan(0);
    expect(cluster.lastTile).not.toBeNull();
    expect(cluster.aggregationShare).toBe(0);
    initial.target.dispose();
  }
  target.dispose();cluster.dispose();
});
it('keeps instrument, optical source and foreground state through asynchronous arrival', async () => {
  const {cluster,composite,material,ready,cancel,deliver}=fixture();
  const prepared:Object3D[]=[];
  cluster.prepare(async object=>{prepared.push(object);});
  cluster.setInstrument(NARROWBAND_INSTRUMENT,2);cluster.transmission=.1;
  deliver(sample);await flush();
  expect(ready).toHaveBeenCalledOnce();expect(cluster.ready).toBe(true);expect(composite.visible).toBe(true);
  const points=prepared[0].children[0] as Mesh;
  expect(Array.from(points.geometry.getAttribute('starRgb').array)).toEqual([4,4,4,2,2,2]);
  expect(material.uniforms.uContinuumShare.value).toBe(NARROWBAND_INSTRUMENT.continuumShare);
  const transmission=material.uniforms.uTransmission.value;
  expect(transmission[0]).toBeGreaterThan(transmission[1]);expect(transmission[1]).toBeGreaterThan(transmission[2]);
  cluster.transmission=0;expect(material.uniforms.uTransmission.value).toEqual([0,0,0]);
  cluster.dispose();expect(cancel).toHaveBeenCalledOnce();
});
it('cancels an unfinished survey and ignores late data', () => {
  const {cluster,composite,ready,cancel,deliver}=fixture();
  cluster.dispose();deliver(sample);
  expect(ready).not.toHaveBeenCalled();expect(cluster.ready).toBe(false);expect(composite.visible).toBe(false);
  expect(cancel).toHaveBeenCalledOnce();
});
it('retains all shader resources until every preparation settles, even after a failure and cancellation', async () => {
  for(const synchronous of [true,false]) {
    const {cluster,composite,ready,deliver}=fixture();let finish!:()=>void, calls=0;
    cluster.prepare(()=>{if(calls++===0)return new Promise<void>(resolve=>{finish=resolve;});
      if(synchronous)throw new Error('compile');return Promise.reject(new Error('compile'));});
    deliver(sample);await flush();expect(ready).not.toHaveBeenCalled();
    const disposed=vi.fn();(composite.material as ShaderMaterial).addEventListener('dispose',disposed);
    cluster.dispose();expect(disposed).not.toHaveBeenCalled();
    finish();await flush();expect(disposed).toHaveBeenCalledOnce();expect(ready).not.toHaveBeenCalled();
  }
});
it('publishes only once the survey and both shader preparations arrive in either order', async () => {
  for(const dataFirst of [true,false]) {
    const {cluster,ready,deliver}=fixture(), finish:(()=>void)[]=[];
    cluster.prepare(()=>new Promise<void>(resolve=>{finish.push(resolve);}));await flush();
    if(dataFirst)deliver(sample);
    finish[0]();await flush();expect(ready).not.toHaveBeenCalled();
    finish[1]();await flush();
    if(!dataFirst){expect(ready).not.toHaveBeenCalled();deliver(sample);}
    expect(cluster.ready).toBe(true);expect(ready).toHaveBeenCalledOnce();cluster.dispose();
  }
});
it('restores lens face, mip, viewport, scissor and clear state even when the light prepass throws', () => {
  const {cluster,deliver}=fixture();deliver(sample);
  const {renderer,state,initial,render}=renderFixture(cluster);
  render();expect(state).toEqual(initial);expect(renderer.autoClear).toBe(true);
  expect(cluster.radianceTarget.width).toBe(1024);expect(cluster.lastTile!.targetWidth).toBe(1024);
  renderer.render.mockImplementationOnce(()=>{throw new Error('draw');});
  expect(render).toThrow('draw');expect(state).toEqual(initial);expect(renderer.autoClear).toBe(true);
  cluster.dispose();initial.target.dispose();
});
it('skips invisible, opaque and behind-camera work without growing near-plane allocation', () => {
  const {cluster,material,deliver}=fixture();deliver(sample);
  const {camera,renderer,initial,render}=renderFixture(cluster);
  cluster.transmission=0;render();expect(renderer.render).not.toHaveBeenCalled();expect(material.uniforms.uPresent.value).toBe(0);
  cluster.transmission=1;cluster.intensity=0;render();expect(renderer.render).not.toHaveBeenCalled();
  cluster.intensity=1;camera.position.z=-1000;camera.updateMatrixWorld();render();expect(renderer.render).not.toHaveBeenCalled();
  for(const z of [30,1,0,-1,-30]) {camera.position.z=z;camera.updateMatrixWorld();render();expect(cluster.radianceTarget.width).toBe(1024);}
  expect(renderer.extensions.get).toHaveBeenCalledOnce();cluster.dispose();initial.target.dispose();
});
it('shares camera exposure across the light sum without compensating rejected continuum or changing Eye exposure', () => {
  const {cluster,material,deliver}=fixture();deliver(sample);
  const {camera,initial,render}=renderFixture(cluster);
  cluster.setInstrument(CAMERA_INSTRUMENT,2);render();const exposure=cluster.effectiveExposure;
  cluster.setInstrument(NARROWBAND_INSTRUMENT,2);render();expect(cluster.effectiveExposure).toBe(exposure);
  cluster.setInstrument(EYE_INSTRUMENT,2);render();expect(cluster.effectiveExposure).toBe(2);
  expect(material.uniforms.uBackgroundRgb.value.length()).toBe(0);
  camera.position.z=1e6;camera.updateMatrixWorld();render();expect(cluster.aggregationShare).toBe(1);
  camera.position.z=3;camera.updateMatrixWorld();render();expect(cluster.aggregationShare).toBe(0);
  cluster.dispose();initial.target.dispose();
});
