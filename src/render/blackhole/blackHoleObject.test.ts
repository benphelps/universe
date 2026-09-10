import { expect,it,vi } from 'vitest';
import { Color,Matrix3,PerspectiveCamera,Vector2,Vector3,WebGLCubeRenderTarget,WebGLRenderTarget,type WebGLRenderer } from 'three';
import { BlackHoleObject } from './blackHoleObject';
import { accretionFlowFor } from '../../universe/galaxy/accretionFlow';

function fixture(feeding=1e-5){
  const sky=new WebGLCubeRenderTarget(16);
  const hole=new BlackHoleObject({spin:.89,gravitationalRadiusM:1000,spinAxis:[0,1,0],flow:accretionFlowFor(321000,.89,feeding)},new Float32Array([1,0,0,0,1,0,0,0,1]));
  hole.sky=sky;const camera=new PerspectiveCamera(50,1.5,.01,1e6);camera.position.set(28,7,0);camera.lookAt(0,0,0);
  const initial={target:new WebGLRenderTarget(64,64),face:2,level:1,color:new Color(.2,.3,.4),alpha:.7};
  const state={...initial,color:initial.color.clone()},size=new Vector2(1920,1280);
  const renderer={getDrawingBufferSize:(v:Vector2)=>v.copy(size),getRenderTarget:()=>state.target,
    getActiveCubeFace:()=>state.face,getActiveMipmapLevel:()=>state.level,getClearAlpha:()=>state.alpha,
    getClearColor:(c:Color)=>c.copy(state.color),setClearColor:(c:Color|number,alpha:number)=>{state.color.set(c);state.alpha=alpha;},
    setRenderTarget:(target:WebGLRenderTarget,face=0,level=0)=>{Object.assign(state,{target,face,level});},
    clear:vi.fn(),render:vi.fn()};
  const draw=(time=0,opacity=1,skyOpacity=1)=>{hole.update(camera,new Vector3(),new Matrix3(),opacity,skyOpacity,time);hole.render(renderer as unknown as WebGLRenderer);};
  const dispose=()=>{hole.dispose();sky.dispose();initial.target.dispose();};
  return {hole,camera,sky,renderer,state,initial,size,draw,dispose};
}
it('renders native drawing-buffer pixels and reuses unchanged GPU inputs',()=>{
  const f=fixture();let dimensions:number[]=[];
  f.renderer.render.mockImplementation(()=>{dimensions=[f.state.target.width,f.state.target.height];});
  f.draw();expect(dimensions).toEqual([1920,1280]);expect(f.state).toEqual(f.initial);
  // One material-cache draw and one native trace initially; camera-only
  // changes reuse the material, while the complete image still retraces.
  f.draw();f.camera.position.x+=1e-13;f.draw();expect(f.renderer.render).toHaveBeenCalledTimes(2);
  f.camera.position.x+=.1;f.draw();expect(f.renderer.render).toHaveBeenCalledTimes(3);
  f.camera.rotation.y+=.01;f.draw();expect(f.renderer.render).toHaveBeenCalledTimes(4);
  f.camera.fov=40;f.draw();expect(f.renderer.render).toHaveBeenCalledTimes(5);
  f.size.set(2400,1600);f.draw();expect(dimensions).toEqual([2400,1600]);expect(f.renderer.render).toHaveBeenCalledTimes(6);f.dispose();
});
it('invalidates time, sky capture, opacity and replacement textures without stale frames',()=>{
  const f=fixture();f.draw();f.draw(1);expect(f.renderer.render).toHaveBeenCalledTimes(4);
  f.draw(1);expect(f.renderer.render).toHaveBeenCalledTimes(4);
  f.sky.texture.userData.lensedSkyVersion=1;f.draw(1);expect(f.renderer.render).toHaveBeenCalledTimes(5);
  f.draw(1,.5);f.draw(1,.5,.5);expect(f.renderer.render).toHaveBeenCalledTimes(7);
  f.hole.sky=f.sky;f.draw(1,.5,.5);expect(f.renderer.render).toHaveBeenCalledTimes(8);f.dispose();
});
it('does not retrace a flow-free hole for time changes, and retries failed renders with restored state',()=>{
  const f=fixture(1e-12);expect(f.hole.plasmaStatus).toBeNull();f.draw();f.draw(10);expect(f.renderer.render).toHaveBeenCalledTimes(1);
  f.camera.position.x+=1;f.renderer.render.mockImplementationOnce(()=>{throw Error('draw');});
  expect(()=>f.draw()).toThrow('draw');expect(f.state).toEqual(f.initial);
  f.draw();expect(f.renderer.render).toHaveBeenCalledTimes(3);f.dispose();
});
it('waits for sibling shader preparation before reporting a compile failure',async()=>{
  const f=fixture(1e-12);let release!:()=>void,settled=false;
  const waiting=new Promise<void>(resolve=>{release=resolve;});
  const prepare=vi.fn().mockRejectedValueOnce(Error('shader')).mockReturnValueOnce(waiting);
  const done=f.hole.prepare(prepare).catch(error=>{settled=true;return error;});
  await Promise.resolve();await Promise.resolve();expect(settled).toBe(false);
  release();expect((await done).message).toBe('shader');f.dispose();
});
it('uses the evolving thin disk at native resolution and reuses a paused image',()=>{
  const f=fixture(.1);
  expect(f.hole.diskStatus?.textureBytes).toBe(131072);
  expect(f.hole.plasmaStatus).toBeNull();
  f.draw();expect(f.renderer.render).toHaveBeenCalledTimes(1);
  f.draw();expect(f.renderer.render).toHaveBeenCalledTimes(1);
  f.draw(1);expect(f.renderer.render).toHaveBeenCalledTimes(2);
  expect(f.hole.diskStatus!.timeOrbits).toBeGreaterThan(0);
  f.draw(1);expect(f.renderer.render).toHaveBeenCalledTimes(2);
  f.dispose();
});
