import { BufferAttribute, Color, FloatType, Group, InstancedMesh, Mesh, PerspectiveCamera, Scene, SphereGeometry, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three';
import { prepareGroundMaterials } from '../../src/render/terrain/materialPreparation';
import { AU, G, SOLAR_MASS } from '../../src/core/physics/constants';
import { mu } from '../../src/core/physics/units';
import { generateStar } from '../../src/universe/star/generate';
import { computeZones } from '../../src/universe/system/zones';
import { characterizePlanet } from '../../src/universe/planet/characterize';
import { deriveCirculation } from '../../src/universe/planet/circulation';
import { createSolidPlanetMaterial } from '../../src/render/planet/solidPlanetMaterial';
import { createGiantMaterial } from '../../src/render/planet/giantMaterial';
import { uploadSurfaceCube } from '../../src/render/planet/surfaceCube';
import { createScatterMaterial } from '../../src/render/terrain/scatterObjects';
import { applySeasonalSurface, SeasonalSurfaceOverlay } from '../../src/render/terrain/seasonalSurface';
import type { SeasonalSurfaceField } from '../../src/universe/planet/seasonalSurface';
import type { SurfaceParams } from '../../src/universe/surface/params';
import { createTerrainMaterial } from '../../src/render/terrain/terrainMaterial';
import { createMagmaMaterial } from '../../src/render/terrain/oceanSphere';
import { applySurfaceLight, VACUUM } from '../../src/render/lighting/surfaceLight';

const star = generateStar(1n, { massInitial: 1, ageGyr: 4.6, feH: 0, withCompanions: false });
const elements = { semiMajorAxis: AU, eccentricity: 0, inclination: 0, longitudeOfAscendingNode: 0, argumentOfPeriapsis: 0, meanAnomalyAtEpoch: 0, epoch: 0 };
const physical = characterizePlanet(19n, 'rocky', 1, elements, { star, centralLuminosity: star.luminosity, mu: mu(G * SOLAR_MASS), zones: computeZones(star.luminosity, star.tEff, star.ageGyr, 1) });
physical.appearance.clouds.coverage = 0;
physical.appearance.landColorA = physical.appearance.landColorB = [.2,.2,.2];
physical.appearance.lavaGlow = 0;
physical.climate.surfaceMeanK = 1800;
physical.climate.magmaTemperatureK = 1800;
physical.climate.dayNightDeltaK = 0;
document.querySelector('button')!.onclick = async () => {
  const errors: string[] = [], results: object[] = [];
  const renderer = new WebGLRenderer(); renderer.setSize(129,129);
  renderer.debug.onShaderError = (gl, p, v, f) => errors.push([gl.getProgramInfoLog(p),gl.getShaderInfoLog(v),gl.getShaderInfoLog(f)].join('\n'));
  const target = new WebGLRenderTarget(129,129,{type:FloatType});
  const cube = uploadSurfaceCube(renderer, Array.from({length:6},()=>new Uint8Array([51,51,51,0])),1);
  const scene = new Scene(), camera = new PerspectiveCamera(40,1,.01,20); camera.position.set(0,0,3);camera.lookAt(0,0,0);
  const geometry = new SphereGeometry(1,64,32), n = geometry.getAttribute('position').count;
  geometry.setAttribute('color',new BufferAttribute(new Float32Array(n*3).fill(.2),3));
  geometry.setAttribute('aMorph',new BufferAttribute(new Float32Array(n*4),4));
  const materials = { solid:createSolidPlanetMaterial(physical), terrain:createTerrainMaterial(2), scatter:createScatterMaterial(), magma:createMagmaMaterial(physical,[0,0,0]), giant:createGiantMaterial(physical,deriveCirculation(physical)) };
  const mesh = new Mesh(geometry, materials.solid);scene.add(mesh);
  for (const [name,m] of Object.entries(materials)) {
    mesh.material=m;applySurfaceLight(m,{...VACUUM,radius:1});
    if(m.uniforms.uHasSurface){m.uniforms.uHasSurface.value=true;m.uniforms.uSurfaceCube.value=cube.texture;}
    if(m.uniforms.uRadiusKm)m.uniforms.uRadiusKm.value=1;
    if(m.uniforms.uDeckA){m.uniforms.uDeckA.value=cube.texture;m.uniforms.uDeckB.value=cube.texture;}
    const render=(exposure:number,lit:boolean,tau=0,thermalExposure=exposure)=>{
      m.uniforms.uLightColor.value=new Color(lit?exposure:0,lit?exposure:0,lit?exposure:0);
      m.uniforms.uLightDir.value=new Vector3(0,0,1);m.uniforms.uSurfaceExposure.value=thermalExposure;
      m.uniforms.uOpticalDepth.value.setRGB(tau,tau,tau);
      m.uniforms.uRayleighDepth.value.setRGB(tau,tau,tau);
      // Pure outgoing absorption isolates whether heat follows the view path.
      renderer.setRenderTarget(target);renderer.render(scene,camera);
      const pixel=new Float32Array(4);renderer.readRenderTargetPixels(target,64,64,1,1,pixel);return [...pixel];
    };
    if(m.uniforms.uSurfaceTemperatureK)m.uniforms.uSurfaceTemperatureK.value=1800;
    const heat=render(1,false),both=render(1,true),twice=render(2,true),reflected=render(1,true,0,0),absorbed=render(1,false,.5);
    const additionError=Math.max(...[0,1,2].map(c=>Math.abs(both[c]-heat[c]-reflected[c])/Math.max(1e-9,both[c])));
    const linearError=Math.max(...[0,1,2].map(c=>Math.abs(twice[c]-2*both[c])/Math.max(1e-9,2*both[c])));
    const finite=[...heat,...both,...twice,...absorbed].every(Number.isFinite);
    const attenuated=absorbed[0]<heat[0]*.7;
    if(!finite||linearError>1e-5||additionError>1e-5||!attenuated||heat[0]<=0)errors.push(`${name}: invalid radiometry`);
    results.push({name,heat,both,twice,reflected,absorbed,linearError,additionError,finite,attenuated});
    m.dispose();
  }
  scene.remove(mesh);
  // Constant one-km sampled elevation on deliberately coarse triangles.
  // Their chord interiors fall below the datum; using fragment radius as
  // height would erase snow between vertices and print a triangle grid.
  const coarse=new SphereGeometry(6372,8,4),count=coarse.getAttribute('position').count;
  coarse.setAttribute('aMorph',new BufferAttribute(new Float32Array(count*4),4));
  const colors=new BufferAttribute(new Float32Array(count*3).fill(.2),3);coarse.setAttribute('color',colors);
  const snow=createTerrainMaterial(2),field={latitudeCount:2,frameCount:2,temperatureK:new Float32Array(4).fill(276),cycleSeconds:1} as SeasonalSurfaceField;
  const overlay=new SeasonalSurfaceOverlay(field);
  applySeasonalSurface(snow,overlay,{surfaceIce:true,globalIce:false,magmaCoverage:0,lapseKPerKm:10,atmosphericCapK:200,palette:{ice:[1,1,1]}} as SurfaceParams);
  applySurfaceLight(snow,{...VACUUM,radius:6371});
  snow.uniforms.uLightDir.value=new Vector3(0,0,1);
  const sphere=new Mesh(coarse,snow);scene.add(sphere);
  camera.position.set(3000,1000,20000);camera.far=50000;camera.updateProjectionMatrix();camera.lookAt(0,0,0);
  const pixels=()=>{renderer.setRenderTarget(target);renderer.render(scene,camera);const a=new Float32Array(129*129*4);renderer.readRenderTargetPixels(target,0,0,129,129,a);return a;};
  const seasonal=pixels();snow.uniforms.uSeasonalEnabled.value=0;colors.array.fill(1);colors.needsUpdate=true;const white=pixels();
  let chordError=0;for(let i=0;i<white.length;i++)chordError=Math.max(chordError,Math.abs(white[i]-seasonal[i]));
  const finite=seasonal.every(Number.isFinite)&&white.every(Number.isFinite);
  results.push({name:'snow uses sampled elevation across coarse chords',chordError,finite});
  if(!finite||chordError>1e-5)errors.push('snow chord elevation failed');
  overlay.dispose();snow.dispose();coarse.dispose();scene.remove(sphere);
  physical.climate.surfaceMeanK=300;physical.climate.hydrosphere='none';physical.climate.oceanCoverage=0;
  const cold=createSolidPlanetMaterial(physical);applySurfaceLight(cold,{...VACUUM,radius:1});cold.uniforms.uLightColor.value=new Color(0,0,0);
  scene.add(new Mesh(geometry,cold));camera.position.set(0,0,3);camera.far=20;camera.updateProjectionMatrix();camera.lookAt(0,0,0);
  const coldImage=pixels(),dark=coldImage.every((v,i)=>i%4===3||v===0),unallocated=cold.uniforms.uThermalLut.value===null;
  results.push({name:'cold solid uses no thermal texture and remains dark',dark,unallocated});
  if(!dark||!unallocated)errors.push('cold thermal fallback failed');cold.dispose();
  scene.clear();
  const terrain=createTerrainMaterial(2),scatter=createScatterMaterial();
  renderer.setRenderTarget(target);
  await prepareGroundMaterials(terrain,scatter,object=>renderer.compileAsync(object,camera,scene));
  const programsBefore=renderer.info.programs!.length;
  const instances=new InstancedMesh(geometry,scatter,1);instances.setColorAt(0,new Color(1,1,1));
  const group=new Group();group.add(new Mesh(geometry,terrain),instances);scene.add(group);
  renderer.render(scene,camera);
  const programsAfter=renderer.info.programs!.length;
  results.push({name:'prepared ground variants match actual geometry',programsBefore,programsAfter});
  if(programsAfter!==programsBefore)errors.push('first ground draw compiled a new program');
  instances.dispose();terrain.dispose();scatter.dispose();
  geometry.dispose();cube.dispose();target.dispose();renderer.dispose();renderer.forceContextLoss();
  document.querySelector('pre')!.textContent=JSON.stringify({errors,results},null,2);
};
