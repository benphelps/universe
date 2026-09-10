import { BackSide, Matrix3, Mesh, PerspectiveCamera, Scene, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import type { BlackHoleSolver } from '../../src/render/blackhole/blackHoleObject';
import { StreamingBlackHoleObject as BlackHoleObject } from '../../src/render/blackhole/streamingBlackHoleObject';
import { LensedSky } from '../../src/render/blackhole/lensedSky';
import { RenderPipeline } from '../../src/render/fx/pipeline';
import { gravitationalRadius } from '../../src/core/physics/blackHole';
import { accretionFlowFor } from '../../src/universe/galaxy/accretionFlow';

const params=new URLSearchParams(location.search);
let plasmaSampling:'atlas'|'direct'=params.has('directPlasma')?'direct':'atlas';
const width=Number(params.get('width') || 960),height=Number(params.get('height') || 640);
const scene=new Scene(), camera=new PerspectiveCamera(50,width/height,.001,1e8);
const pipeline=new RenderPipeline(document.querySelector('#canvas')!,scene,camera);
const requestedExposure=Number(params.get('exposure')??.6);
const exposure=Number.isFinite(requestedExposure)&&requestedExposure>0?requestedExposure:.6;
pipeline.setSize(width,height,1);pipeline.exposure=exposure;
const identity=new Matrix3(), origin=new Vector3();
const sky=new LensedSky(1024);
const skyMaterial=new ShaderMaterial({side:BackSide,depthTest:false,depthWrite:false,
  uniforms:{uMode:{value:0}},
  vertexShader:`varying vec3 ray;void main(){ray=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position.z=1e-24*gl_Position.w;}`,
  fragmentShader:`varying vec3 ray;uniform float uMode;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  void main(){vec3 d=normalize(ray);vec2 uv=vec2(atan(d.z,d.x)/6.2831853+.5,asin(d.y)/3.14159265+.5);
  vec3 light=vec3(.18);
  if(uMode<.5){vec2 cell=uv*vec2(24.,12.);vec2 edge=abs(fract(cell-.5)-.5)/max(fwidth(cell),vec2(.001));
  float grid=1.-smoothstep(.7,1.5,min(edge.x,edge.y));light=mix(.08+.3*(d*.5+.5),vec3(1.),grid);
  light+=vec3(2.,.05,.01)*exp(-800.*pow(distance(d,normalize(vec3(-1.,.2,.1))),2.));}
  if(uMode>.5&&uMode<1.5){vec2 cell=uv*vec2(420.,210.);vec2 id=floor(cell);float h=hash(id);
  vec2 offset=fract(cell)-vec2(hash(id+3.),hash(id+7.));float star=exp(-dot(offset,offset)*80.)*step(.97,h);
  light=vec3(.018,.023,.035)+star*mix(vec3(.7,.8,1.),vec3(1.,.65,.35),hash(id+19.))*5.;}
  gl_FragColor=vec4(light,1.);}`});
const dome=new Mesh(new SphereGeometry(1,32,16),skyMaterial);dome.scale.setScalar(1e5);dome.renderOrder=-8;scene.add(dome);
let hole:BlackHoleObject, animate=params.has('animate'), time=0, frames=0, last=0;
let loading=true,comparing=false,buildStarted=0,buildFinished=Infinity;
let loadingFrames=0,loadingLast=0,maxLoadingIntervalMs=0,maxLoadingTaskMs=0;
let loadingStats:Record<string,number>={};
if(typeof PerformanceObserver!=='undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
  new PerformanceObserver(list=>{for(const entry of list.getEntries())
    if(entry.startTime>=buildStarted&&entry.startTime<buildFinished)maxLoadingTaskMs=Math.max(maxLoadingTaskMs,entry.duration);
  }).observe({entryTypes:['longtask']});
}
const orbitAxis=new Vector3(0,1,0);
const intervals:number[]=[],cpu:number[]=[],gpu:number[]=[],calls:number[]=[];
const select=(name:string)=>(document.querySelector('#'+name) as HTMLSelectElement).value;
const median=(values:number[])=>values.length?[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]:null;
const percentile=(values:number[],p:number)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]:null;
async function setup():Promise<boolean>{
  loading=true;buildStarted=performance.now();buildFinished=Infinity;
  loadingFrames=0;loadingLast=0;maxLoadingIntervalMs=0;maxLoadingTaskMs=0;
  if(hole){scene.remove(hole.mesh);hole.dispose();}
  const mode=select('flow');
  const mass=Number(params.get('mass') || 321000), spin=Number(params.get('spin') || .89);
  const feeding=Number(params.get('feeding') || (mode==='disc'?.1:1e-5));
  const options={windIndex:Number(params.get('windIndex')??.35),magneticFlux:Number(params.get('magneticFlux')??10)};
  hole=new BlackHoleObject({flowSeed:BigInt(params.get('diskSeed') ?? '1'),spin,gravitationalRadiusM:gravitationalRadius(mass),spinAxis:[0,1,0],flow:accretionFlowFor(mass,spin,mode==='none'?1e-12:feeding,options)},new Float32Array([1,0,0,0,1,0,0,0,1]), select('solver') as BlackHoleSolver,plasmaSampling );
  hole.sky=sky.target;scene.add(hole.mesh);
  const active=hole;
  hole.prepare(object=>pipeline.prepareSceneObject(object,scene));
  const view=select('view'),distance=view==='far'?240:28;
  camera.position.set(view==='pole'?.0001:Math.cos(.26),view==='pole'?1:view==='equator'?0:Math.sin(.26),0).normalize().multiplyScalar(distance*hole.kmPerRg);
  camera.near=.001*hole.kmPerRg;camera.far=1e8*hole.kmPerRg;camera.updateProjectionMatrix();
  dome.scale.setScalar(1e5*hole.kmPerRg);
  camera.lookAt(origin);camera.updateMatrixWorld();
  skyMaterial.uniforms.uMode.value=['grid','stars','constant'].indexOf(select('sky'));
  sky.capture(pipeline.renderer,scene,origin,[hole.mesh]);
  frames=0;time=0;last=0;intervals.length=cpu.length=gpu.length=calls.length=0;
  document.querySelector('#results')!.textContent='Preparing black hole…';
  const ready=await active.ready;
  if(active!==hole)return false;
  buildFinished=performance.now();loading=false;
  loadingStats={elapsedMs:buildFinished-buildStarted,framesRendered:loadingFrames,maxFrameIntervalMs:maxLoadingIntervalMs};
  if(!ready){document.querySelector('#results')!.textContent=active.generation.error??'Preparation cancelled';frames=360;return false;}
  const plasma=active.preparedData?.hot?.data;
  document.querySelector('#plasma')!.textContent=plasma?JSON.stringify({dynamics:hole.plasmaStatus,
    maxReferenceScatteringRemainderFraction:Math.max(...plasma.model.shells.map(s=>s.scatteringRemainderFraction)),
    electronTemperatureK:plasma.model.shells[0].plasma.electronTemperatureK,
    magneticGauss:plasma.model.shells[0].plasma.magneticGauss,powerScale:plasma.model.powerScale,
    emittedW:plasma.model.emittedLuminosityW,escapedW:plasma.model.escapedLuminosityW,budgetW:plasma.model.budgetW},null,2):'';
  document.querySelector('#results')!.textContent='Warming up…';
  return true;
}
for(const name of ['solver','sky','flow','view']){
  const element=document.querySelector('#'+name) as HTMLSelectElement;
  if(params.has(name))element.value=params.get(name)!;
  if(name==='solver'&&params.has('reference'))element.value='reference';
  element.addEventListener('change',setup);
}
document.querySelector('#lensing')!.addEventListener('change',setup);
document.querySelector('#run')!.addEventListener('click',setup);
document.querySelector('#pause')!.addEventListener('click',()=>{animate=!animate;document.querySelector('#pause')!.textContent=animate?'Pause':'Animate';setup();});
function render(now:number){
  if(loading || frames<360 || animate){
    const start=performance.now();if(animate&&!loading)time+=Number(params.get('timeScale')??1)/60;
    if(params.has('orbit')&&!loading) { camera.position.applyAxisAngle(orbitAxis,.004);camera.lookAt(origin); }
    pipeline.beginFrame();hole.update(camera,origin,identity,(document.querySelector('#lensing') as HTMLInputElement).checked?1:0,1,time);hole.render(pipeline.renderer);pipeline.render();
    if(!loading&&!comparing&&frames>=60&&frames<360){cpu.push(performance.now()-start);calls.push(pipeline.renderer.info.render.calls);if(last)intervals.push(now-last);if(pipeline.gpuFrameMs!==null)gpu.push(pipeline.gpuFrameMs);}
    if(loading) {
      loadingFrames++;
      if(loadingLast)maxLoadingIntervalMs=Math.max(maxLoadingIntervalMs,now-loadingLast);
      loadingLast=now;
      document.querySelector('#results')!.textContent=`Preparing black hole ${Math.round(hole.generation.fraction*100)}% · ${hole.generation.stage} · ${loadingFrames} responsive frames`;
    }
    last=now;if(!loading&&!comparing)frames++;
    if(frames===360)document.querySelector('#results')!.textContent=JSON.stringify({loading:{...loadingStats,maxMainThreadTaskMs:maxLoadingTaskMs},plasmaSampling,plasma:hole.plasmaStatus,disk:hole.diskStatus,sky:select('sky'),flow:select('flow'),view:select('view'),quality:'native',animate,resolution:`${width} × ${height}`,solver:select('solver'),orbit:params.has('orbit'),frames:cpu.length,medianDrawCalls:median(calls),medianGpuMs:median(gpu),medianSubmitMs:median(cpu),medianIntervalMs:median(intervals),p95IntervalMs:percentile(intervals,.95),p99IntervalMs:percentile(intervals,.99),p95GpuMs:percentile(gpu,.95),p99GpuMs:percentile(gpu,.99),maxGpuMs:Math.max(...gpu)},null,2);
  }
  requestAnimationFrame(render);
}
async function compare(kind:'trace'|'material'){
  if(comparing)return;
  comparing=true;
  try {
  animate=false;document.querySelector('#pause')!.textContent='Animate';
  const solver=document.querySelector('#solver') as HTMLSelectElement;
  const gl=pipeline.renderer.getContext();
  const draw=async()=>{
    if(!await setup())return null;
    pipeline.beginFrame();hole.update(camera,origin,identity,1,1,0);
    hole.render(pipeline.renderer);pipeline.render();
    const pixels=new Uint8Array(width*height*4);
    gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    if(gl.getError()!==gl.NO_ERROR)throw new Error('pixel readback failed');
    if(!pixels.some((value,index)=>index%4!==3&&value>0))throw new Error('blank comparison frame');
    return pixels;
  };
  solver.value='regular';
  if(kind==='material')plasmaSampling='direct';
  const regular=await draw();if(!regular)return;
  if(kind==='trace')solver.value='fine';else plasmaSampling='atlas';
  const fine=await draw();if(!fine)return;
  let sum=0,square=0,large=0,max=0;
  for(let i=0;i<regular.length;i+=4){
    let error=0;
    for(let c=0;c<3;c++){const d=Math.abs(regular[i+c]-fine[i+c])/255;sum+=d;square+=d*d;error=Math.max(error,d);}
    if(error>.1)large++;max=Math.max(max,error);
  }
  frames=360;
  document.querySelector('#results')!.textContent=JSON.stringify({comparison:kind==='trace'?'regular vs fine, same material and frozen time':'direct vs cached plasma, same regular trace and frozen time',
    resolution:`${width} × ${height}`,exposure,meanAbsoluteError:sum/(width*height*3),rmsError:Math.sqrt(square/(width*height*3)),
    fractionPixelsOver10Percent:large/(width*height),maxChannelError:max},null,2);
  } catch(error) {document.querySelector('#results')!.textContent=String(error);}
  finally {comparing=false;}
}
document.querySelector('#compare')!.addEventListener('click',()=>compare('trace'));
document.querySelector('#compare-material')!.addEventListener('click',()=>compare('material'));
document.querySelector('#pause')!.textContent=animate?'Pause':'Animate';setup();requestAnimationFrame(render);
