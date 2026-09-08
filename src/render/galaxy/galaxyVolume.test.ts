import { expect,it,vi } from 'vitest';
import { Color,DataTexture,Data3DTexture,Matrix3,PerspectiveCamera,Scene,ShaderMaterial,Vector3,Vector4,WebGLRenderTarget,type WebGLRenderer } from 'three';
import { GalaxyVolume } from './galaxyVolume';
import { galaxyLutTextures,type GalaxyLuts } from './galaxyLuts';
import { NARROWBAND_INSTRUMENT,EYE_INSTRUMENT } from '../../universe/galaxy/displayLaw';
vi.mock('./galaxyLuts',()=>({galaxyLutTextures:vi.fn()}));
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function fixture() {
  let finish!:()=>void;
  const luts:GalaxyLuts={armLut:new DataTexture(),clumpTile:new Data3DTexture(),particles:null,ready:new Promise<void>(resolve=>{finish=resolve;})};
  vi.mocked(galaxyLutTextures).mockReturnValue(luts);
  const ready=vi.fn(), volume=new GalaxyVolume({xPc:0,yPc:0,zPc:0},new Float32Array([1,0,0,0,1,0,0,0,1]),ready);
  const deliver=()=>{luts.particles={count:1,positionsPc:new Float32Array([0,0,0]),opticalRgb:new Float32Array([3,2,1]),expectedRgb:[3,2,1],realizedRgb:[3,2,1],selectedMeanRgb:[.3,.2,.1],radiusPc:26000};finish();};
  const material=volume.mesh.material as ShaderMaterial;
  const camera=new PerspectiveCamera(45,1,1,1e6);camera.position.z=54000;camera.updateMatrixWorld();
  const update=(opacity=1)=>volume.update(camera.position,new Vector3(),new Matrix3(),1,opacity,1000);
  const state={target:new WebGLRenderTarget(64,64),face:3,level:2,viewport:new Vector4(4,8,2048,1024),scissor:new Vector4(1,2,30,40),scissorTest:false,color:new Color(.2,.3,.4),alpha:.4};
  const initial={...state,viewport:state.viewport.clone(),scissor:state.scissor.clone(),color:state.color.clone()};
  state.target.viewport.copy(state.viewport);state.target.scissor.copy(state.scissor);
  const renderer={autoClear:true,extensions:{get:vi.fn(()=>({}))},getCurrentViewport:(v:Vector4)=>v.copy(state.viewport),getRenderTarget:()=>state.target,
    getActiveCubeFace:()=>state.face,getActiveMipmapLevel:()=>state.level,getClearAlpha:()=>state.alpha,getClearColor:(v:Color)=>v.copy(state.color),
    setRenderTarget:(target:WebGLRenderTarget,face=0,level=0)=>{Object.assign(state,{target,face,level,scissorTest:target.scissorTest});state.viewport.copy(target.viewport);state.scissor.copy(target.scissor);},
    setClearColor:(c:Color|number,alpha:number)=>{state.color.set(c);state.alpha=alpha;},clear:vi.fn(),render:vi.fn()};
  const draw=()=>volume.mesh.onBeforeRender(renderer as unknown as WebGLRenderer,new Scene(),camera,volume.mesh.geometry,material,null!);
  const dispose=()=>{volume.dispose();initial.target.dispose();luts.armLut.dispose();luts.clumpTile.dispose();};
  return {volume,material,ready,deliver,camera,update,renderer,state,initial,draw,dispose};
}
it('retains the full diffuse population until sources arrive and debits only when their light is drawn',async()=>{
  const f=fixture();f.update();f.draw();expect(f.renderer.render).not.toHaveBeenCalled();expect(f.material.uniforms.uSelectedThin.value.toArray()).toEqual([0,0,0]);
  f.deliver();await flush();f.draw();expect(f.volume.starCount).toBe(1);expect(f.material.uniforms.uSelectedThin.value.toArray()).toEqual([.3,.2,.1]);
  f.volume.starsEnabled=false;f.draw();expect(f.material.uniforms.uStarsActive.value).toBe(0);expect(f.material.uniforms.uSelectedThin.value.length()).toBe(0);
  f.update(0);expect(f.volume.starCount).toBe(0);f.dispose();
});
it('restores render state on failure, bounds allocation, and caches only unchanged physical inputs',async()=>{
  const f=fixture();f.deliver();await flush();f.update();f.draw();expect(f.state).toEqual(f.initial);expect(f.renderer.autoClear).toBe(true);
  expect(f.volume.starTarget.width).toBe(1024);expect(f.volume.starTargetSize.toArray()).toEqual([1024,512]);expect(f.renderer.render).toHaveBeenCalledTimes(2);
  f.draw();expect(f.renderer.render).toHaveBeenCalledTimes(2);
  f.volume.setInstrument(NARROWBAND_INSTRUMENT,2);f.update();f.draw();expect(f.renderer.render).toHaveBeenCalledTimes(2);
  f.camera.rotation.y=.1;f.camera.updateMatrixWorld();f.draw();expect(f.renderer.render).toHaveBeenCalledTimes(3); // direction only: no new dust columns
  f.camera.position.z=1;f.update();f.draw();expect(f.renderer.render).toHaveBeenCalledTimes(5);
  f.camera.position.z=-1;f.update();f.renderer.render.mockImplementationOnce(()=>{throw Error('draw');});expect(f.draw).toThrow('draw');
  expect(f.state).toEqual(f.initial);expect(f.renderer.autoClear).toBe(true);expect(f.material.uniforms.uStarsActive.value).toBe(0);
  f.draw();expect(f.volume.starTarget.width).toBe(1024);f.dispose();
});
it('retains all three shader preparations through rejection and disposal, and ignores late sources',async()=>{
  const f=fixture();let finish!:()=>void,calls=0;
  f.volume.prepare(()=>{if(calls++===0)return new Promise<void>(resolve=>{finish=resolve;});return Promise.reject(Error('compile'));});
  await flush();expect(calls).toBe(3);const disposed=vi.fn();f.material.addEventListener('dispose',disposed);
  f.volume.dispose();f.deliver();await flush();expect(disposed).not.toHaveBeenCalled();expect(f.ready).not.toHaveBeenCalled();
  finish();await flush();expect(disposed).toHaveBeenCalledOnce();expect(f.volume.starCount).toBe(0);f.dispose();expect(disposed).toHaveBeenCalledOnce();
});
it('applies instrument response to the joint light while preserving Eye and the local sky pedestal',()=>{
  const f=fixture();f.volume.setInstrument(NARROWBAND_INSTRUMENT,2,4);f.update(.5);
  expect(f.material.uniforms.uContinuumShare.value).toBe(.06);expect(f.material.uniforms.uPedestalRadiance.value).toBe(2);
  f.volume.setInstrument(EYE_INSTRUMENT,2,4);f.update(.5);expect(f.material.uniforms.uPedestalRadiance.value).toBe(0);f.dispose();
});
it('keeps the full galaxy background through asynchronous source arrival',async()=>{
  const f=fixture();expect(f.volume.ready).toBe(false);f.volume.setInstrument(NARROWBAND_INSTRUMENT,1,8);
  f.update(1);expect(f.material.uniforms.uPedestalRadiance.value).toBe(0);
  const gain=f.material.uniforms.uGain.value;
  f.deliver();await flush();expect(f.volume.ready).toBe(true);f.update(1);f.draw();
  expect(f.material.uniforms.uPedestalRadiance.value).toBe(0);
  expect(f.material.uniforms.uGain.value).toBe(gain);f.dispose();
});
