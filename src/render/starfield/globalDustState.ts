import { globalCloudField } from '../../universe/galaxy/globalDust';
import { DataTexture, Matrix3, RGBAFormat, Vector3, type Texture } from 'three';
const empty=new DataTexture(new Uint8Array(4),1,1,RGBAFormat);
empty.needsUpdate=true;
export const starGlobalDustUniforms = {
  uStarArmLut:{value:empty as Texture},
  uGlobalDustEnabled:{value:0},
  uStarCloudField:{value:0},
  uStarDustObserverPc:{value:new Vector3()},
  uStarObserverOffsetPc:{value:new Vector3()},
  uStarCameraToGalaxy:{value:new Matrix3()},
};
export function setStarGlobalDust(arm:Texture,observerKpc:Vector3,cameraToGalaxy:Matrix3): void {
  hasFrame=false;
  starGlobalDustUniforms.uStarObserverOffsetPc.value.set(0,0,0);
  starGlobalDustUniforms.uStarArmLut.value=arm;
  starGlobalDustUniforms.uGlobalDustEnabled.value=1;
  starGlobalDustUniforms.uStarCloudField.value=globalCloudField();
  starGlobalDustUniforms.uStarDustObserverPc.value.copy(observerKpc).multiplyScalar(1000);
  starGlobalDustUniforms.uStarCameraToGalaxy.value.copy(cameraToGalaxy);
}

// A cube capture has six different cameras. Seat every draw from its
// actual camera instead of reusing the main view's rotation/position.
const frameWorldToGalaxy=new Matrix3(),frameWorldKm=new Vector3(),frameGalaxyPc=new Vector3();
const drawCameraRotation=new Matrix3(),drawPosition=new Vector3();
let framePcKm=1,hasFrame=false;
export function setStarDustFrame(worldToGalaxy:Matrix3,observerWorldKm:Vector3,pcKm:number): void {
  frameWorldToGalaxy.copy(worldToGalaxy);frameWorldKm.copy(observerWorldKm);
  frameGalaxyPc.copy(starGlobalDustUniforms.uStarDustObserverPc.value);
  framePcKm=pcKm;hasFrame=true;
}
export function installStarDustCamera(material:import('three').ShaderMaterial): void {
  const before=material.onBeforeRender;
  material.onBeforeRender=(...args)=>{
    if(hasFrame) {
      const camera=args[2];
      drawCameraRotation.setFromMatrix4(camera.matrixWorld);
      starGlobalDustUniforms.uStarCameraToGalaxy.value.multiplyMatrices(frameWorldToGalaxy,drawCameraRotation);
      drawPosition.setFromMatrixPosition(camera.matrixWorld).sub(frameWorldKm).applyMatrix3(frameWorldToGalaxy).divideScalar(framePcKm);
      starGlobalDustUniforms.uStarObserverOffsetPc.value.copy(drawPosition);
      starGlobalDustUniforms.uStarDustObserverPc.value.copy(frameGalaxyPc).add(drawPosition);
      material.uniforms.uCameraToGalaxy?.value.copy(starGlobalDustUniforms.uStarCameraToGalaxy.value);
    }
    before.call(material,...args);
  };
}
