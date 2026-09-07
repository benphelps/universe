import { Color, DepthTexture, FloatType, PerspectiveCamera, Scene, ShaderMaterial, WebGLRenderer, WebGLRenderTarget } from 'three';
import { CloudPass } from '../../src/render/fx/cloudPass';
import { createCloudShell } from '../../src/render/terrain/cloudShell';
import { setGalaxySeed } from '../../src/universe/galaxy/galaxySeed';
import { generateSystem } from '../../src/universe/system/generate';
// Exact camera pose from the archived segmented-horizon regression.
const pose = {"altitudeKm":45.653524959236165,"position":[4986.907793469849,-8.700487085251254e-10,-1959.9617456326048],"quaternion":[-0.3833528313665961,-0.5841595819033193,0.584415707532231,-0.4126214613218211],"timeDays":0.053942951583963845};
setGalaxySeed(0x53494d5f554e4956n);
const physical = generateSystem(0xd50464b00652fab0n).planets[6].physical;
document.querySelector('button')!.onclick=async()=>{
 const results=[], errors:string[]=[];
 for(const reversedDepthBuffer of [false,true]) for(const altitude of [45.65,14,13.7,13,2,.01]) {
  const renderer=new WebGLRenderer({reversedDepthBuffer}); renderer.setSize(890,720); renderer.debug.checkShaderErrors=true;
  renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{errors.push([gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].join('\n'));};
  const camera=new PerspectiveCamera(55,890/720,.01,1e10);
  camera.position.fromArray(pose.position).normalize().multiplyScalar(physical.bulk.radiusEarth*6371+altitude); camera.quaternion.fromArray(pose.quaternion);camera.updateMatrixWorld();
  const source=new WebGLRenderTarget(890,720,{type:FloatType,depthTexture:new DepthTexture(890,720)}),dest=source.clone();
  const scene=new Scene();scene.background=new Color(.2,.2,.2);
  const shell=createCloudShell(physical,physical.bulk.radiusEarth*6371)!;
  const material=shell.material as ShaderMaterial;
  material.uniforms.uTimeDays.value=pose.timeDays;material.uniforms.uLightDir.value=[1,0,0];
  const pass=new CloudPass(camera);pass.setShell(shell);
  renderer.setRenderTarget(source);renderer.render(scene,camera);pass.render(renderer,dest,source);
  const pixels=new Float32Array(890*720*4);renderer.readRenderTargetPixels(dest,0,0,890,720,pixels);
  const nonfinite=[];let negative=0,min=Infinity,max=-Infinity;
  for(let i=0;i<pixels.length;i+=4) {if(!Number.isFinite(pixels[i]+pixels[i+1]+pixels[i+2])) nonfinite.push([i/4%890,Math.floor(i/4/890)]);else {min=Math.min(min,pixels[i],pixels[i+1],pixels[i+2]);max=Math.max(max,pixels[i],pixels[i+1],pixels[i+2]);if(Math.min(pixels[i],pixels[i+1],pixels[i+2])<0)negative++;}}
  if(nonfinite.length || negative || max-min<.01) errors.push(`${reversedDepthBuffer}/${altitude}: invalid or missing cloud light`);
  results.push({altitude,reversedDepthBuffer,nonfinite:nonfinite.length,locations:nonfinite.slice(0,8),negative,min,max});
  await new Promise(resolve=>setTimeout(resolve,0));
  source.dispose();dest.dispose();pass.dispose();shell.geometry.dispose();material.dispose();renderer.dispose();renderer.forceContextLoss();
 }
 document.querySelector('pre')!.textContent=JSON.stringify({errors,results},null,2);
};
