import { Color, HalfFloatType, PerspectiveCamera, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import { NebulaCarrier } from '../../src/render/galaxy/nebulaVolume';
import { auditGlCalls } from '../../src/render/fx/glCallAudit';
import { loadingWorkSpans } from '../../src/app/loadingWorkAudit';
import { prepareGroundMaterials } from '../../src/render/terrain/materialPreparation';
import { createTerrainMaterial } from '../../src/render/terrain/terrainMaterial';
import { createScatterMaterial } from '../../src/render/terrain/scatterObjects';
import { setGalaxySeed } from '../../src/universe/galaxy/galaxySeed';
setGalaxySeed(0x53494d5f554e4956n);
const delay=()=>new Promise(resolve=>setTimeout(resolve,20));
document.querySelector('button')!.onclick=async()=>{
 const results=[];
 for(const prepared of [false,true,false,true]) {
  const renderer=new WebGLRenderer({reversedDepthBuffer:true});renderer.debug.checkShaderErrors=false;
  renderer.setSize(512,512); const stop=auditGlCalls(renderer.getContext() as WebGL2RenderingContext);
  const camera=new PerspectiveCamera(55,1,.01,1e10);camera.position.set(0,0,3);camera.updateMatrixWorld();
  const scene=new Scene();scene.background=new Color(.01,.01,.01);
  const target=new WebGLRenderTarget(512,512,{type:HalfFloatType});renderer.setRenderTarget(target);
  const carriers=Array.from({length:9},()=>new NebulaCarrier({xPc:0,yPc:0,zPc:0},new Float32Array([1,0,0,0,1,0,0,0,1])));
  for(const carrier of carriers) {scene.add(carrier.mesh);carrier.mesh.scale.setScalar(10);}
  const terrain=createTerrainMaterial(2),scatter=createScatterMaterial();
  if(prepared) {
   for(const carrier of carriers) carrier.prepare(mesh=>renderer.compileAsync(mesh,camera,scene));
   await prepareGroundMaterials(terrain,scatter,mesh=>renderer.compileAsync(mesh,camera,scene));
   while(carriers.some(c=>!c.ready)) await delay();
  }
  for(const carrier of carriers)carrier.opacity=1;
  const before={...renderer.info.memory,programs:renderer.info.programs!.length};
  const start=performance.now();renderer.render(scene,camera);const firstDrawMs=performance.now()-start;
  const calls=loadingWorkSpans().filter(span=>span.startTime>=start);
  results.push({prepared,firstDrawMs,before,after:{...renderer.info.memory,programs:renderer.info.programs!.length},calls});
  for(const carrier of carriers)carrier.dispose();terrain.dispose();scatter.dispose();target.dispose();stop();renderer.dispose();renderer.forceContextLoss();
  document.querySelector('pre')!.textContent=JSON.stringify(results,null,2);await delay();
 }
};
