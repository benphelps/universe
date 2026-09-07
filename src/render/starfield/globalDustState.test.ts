import {it,expect,vi} from 'vitest';
import {DataTexture,Matrix3,PerspectiveCamera,Scene,Vector3,Vector4,type WebGLRenderer} from 'three';
import {createStarPointsMaterial} from './neighborStars';
import {setStarGlobalDust,setStarDustFrame,starGlobalDustUniforms} from './globalDustState';

it('keeps one physical source column through differently positioned capture cameras',()=>{
  const texture=new DataTexture(),rotation=new Matrix3().set(0,-1,0,1,0,0,0,0,1);
  setStarGlobalDust(texture,new Vector3(8,0,.08),new Matrix3());
  setStarDustFrame(rotation,new Vector3(100,0,0),1000);
  const material=createStarPointsMaterial(1000),scene=new Scene();
  const renderer={getCurrentViewport:(v:Vector4)=>v.set(0,0,256,256)} as WebGLRenderer;
  const source=new Vector3(1000,2000,3000),expected=new Vector3(7998,.9,83);
  for(const position of [new Vector3(100,0,0),new Vector3(120,-40,0),new Vector3(-400,20,80)]) {
    const camera=new PerspectiveCamera(90,1,.1,1e9);camera.position.copy(position);camera.lookAt(source);camera.updateMatrixWorld();
    material.onBeforeRender(renderer,scene,camera,null!,null!,null!);
    const relative=source.clone().applyMatrix4(camera.matrixWorldInverse).applyMatrix3(starGlobalDustUniforms.uStarCameraToGalaxy.value).divideScalar(1000);
    expect(relative.add(starGlobalDustUniforms.uStarDustObserverPc.value).distanceTo(expected)).toBeLessThan(1e-10);
    expect((material.uniforms.uCameraToGalaxy.value as Matrix3).elements).toEqual(starGlobalDustUniforms.uStarCameraToGalaxy.value.elements);
  }
  material.dispose();texture.dispose();setStarGlobalDust(new DataTexture(),new Vector3(),new Matrix3());
  starGlobalDustUniforms.uGlobalDustEnabled.value=0;
});

it('does not choose a galaxy while importing the dust shaders',async()=>{
  vi.resetModules();
  await import('../glsl/globalStarDust');
  await import('./globalDustState');
  const {setGalaxySeed,galaxySeed}=await import('../../universe/galaxy/galaxySeed');
  expect(()=>setGalaxySeed(0x638fa1989d88dbbcn)).not.toThrow();
  expect(galaxySeed()).toBe(0x638fa1989d88dbbcn);
});
