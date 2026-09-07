/** Controlled physical climate, actual production terrain/seasonal materials.
 * Fixed neutral illumination and no sky isolate seasonal albedo changes. */
import { Color, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { AU, G, SOLAR_MASS } from '../../src/core/physics/constants';
import { mu } from '../../src/core/physics/units';
import { generateStar } from '../../src/universe/star/generate';
import { computeZones } from '../../src/universe/system/zones';
import { characterizePlanet } from '../../src/universe/planet/characterize';
import { buildSeasonalCycle, type SeasonalClimateInput } from '../../src/universe/planet/seasonalClimate';
import { buildSeasonalSurface, seasonalSurfaceTemperatureAt } from '../../src/universe/planet/seasonalSurface';
import { buildAnnualMeanField } from '../../src/universe/planet/annualMean';
import { buildAnnualInsolation, annualSurfaceTemperatures } from '../../src/universe/planet/surfaceClimate';
import { createSurfaceField } from '../../src/universe/surface/field';
import { createTerrainMaterial } from '../../src/render/terrain/terrainMaterial';
import { createOceanMaterial } from '../../src/render/terrain/oceanSphere';
import { createScatterMaterial } from '../../src/render/terrain/scatterObjects';
import { SeasonalSurfaceOverlay, applySeasonalSurface } from '../../src/render/terrain/seasonalSurface';
import { SPLIT_RATIO, TerrainChunkManager } from '../../src/render/terrain/chunkManager';
const star=generateStar(1n,{massInitial:1,ageGyr:4.6,feH:0,withCompanions:false});
const elements={semiMajorAxis:AU,eccentricity:.05,inclination:0,longitudeOfAscendingNode:0,argumentOfPeriapsis:0,meanAnomalyAtEpoch:0,epoch:0};
const physical=characterizePlanet(19n,'rocky',1,elements,{star,centralLuminosity:star.luminosity,mu:mu(G*SOLAR_MASS),zones:computeZones(star.luminosity,star.tEff,star.ageGyr,1)});
const input:SeasonalClimateInput={forcing:{sources:[{luminositySolar:1,path:[]}],origin:[],orbit:{mu:mu(G*SOLAR_MASS),elements}},
  rotation:{periodHours:6,obliquityRad:1.15,locked:false,spinOrbitResonance:null},albedo:.3,opticalDepth:.6,internalWm2:.1,pressureBar:.6,heatCapacityJm2K:8e6,referenceMeanK:280};
const c=buildSeasonalCycle(input);if(c.status!=='ready')throw Error(c.reason);
const annual=buildAnnualMeanField(c.cycle),seasonal=buildSeasonalSurface(c.cycle);if(annual.status!=='ready'||seasonal.status!=='ready')throw Error('Field budget');
physical.rotation=input.rotation;physical.forcing=input.forcing;
physical.climate={...physical.climate,hydrosphere:'oceans',oceanCoverage:.35,biosphere:false,dayNightDeltaK:0,magmaTemperatureK:0,surfaceMeanK:annual.field.meanK,
  surfaceField:annualSurfaceTemperatures(buildAnnualInsolation(input.forcing,input.rotation),input.albedo,input.opticalDepth,input.internalWm2,input.pressureBar)};
physical.appearance.landColorA=[.16,.13,.07];physical.appearance.landColorB=[.32,.26,.17];physical.appearance.iceColor=[.8,.85,.9];physical.appearance.oceanColor=[.025,.065,.1];
const field=createSurfaceField(physical.seedHex,physical,{annualMean:annual.field}),radius=field.params.radiusM/1000;
const overlay=new SeasonalSurfaceOverlay(seasonal.field),terrain=createTerrainMaterial(SPLIT_RATIO),scatter=createScatterMaterial(),water=createOceanMaterial(physical.appearance.oceanColor,physical.appearance.iceColor);
const renderer=new WebGLRenderer({antialias:true});renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight-70);document.body.append(renderer.domElement);
const scene=new Scene();scene.background=new Color(.015,.02,.03);
const camera=new PerspectiveCamera(55,innerWidth/(innerHeight-70),.0001,radius*20);
const normal=new Vector3(0,.65,Math.sqrt(1-.65**2));
// Choose land in a seasonal northern latitude without changing geometry.
for(let i=0;i<360;i++){const phi=i*Math.PI/180;const p=new Vector3(Math.sin(phi)*Math.sqrt(1-.65**2),.65,Math.cos(phi)*Math.sqrt(1-.65**2));if(field.heightAt(p)>field.waterLevelAt(p)+200){normal.copy(p);break;}}
const tangent=new Vector3().crossVectors(normal,new Vector3(0,1,0)).normalize();
const light=normal.clone().multiplyScalar(.8).addScaledVector(tangent,-.6).normalize();
for(const m of [terrain,scatter,water]) {m.uniforms.uPlanetRadius.value=radius;m.uniforms.uLightColor.value=new Color(1,1,1);m.uniforms.uLightDir.value=light;}
for(const m of [terrain,scatter])applySeasonalSurface(m,overlay,field.params);
const manager=new TerrainChunkManager(scene,terrain,water,scatter,{type:'init',seedHex:physical.seedHex,physical,annualMean:annual.field},radius,[]);
let ground=false,phase=0,running=false,last=performance.now();
let winter=0,summer=0,min=Infinity,max=-Infinity;
for(let k=0;k<seasonal.field.frameCount;k++){const t=seasonalSurfaceTemperatureAt(seasonal.field,normal.y,k/seasonal.field.frameCount*c.cycle.cycleSeconds);if(t<min){min=t;winter=k/seasonal.field.frameCount;}if(t>max){max=t;summer=k/seasonal.field.frameCount;}}
phase=winter;
function pose(){camera.near=ground?.0001:radius*.01;camera.updateProjectionMatrix();const h=Math.max(field.heightAt(normal),field.waterLevelAt(normal))/1000;
  if(ground){camera.up.copy(normal);camera.position.copy(normal).multiplyScalar(radius+h+.003);camera.lookAt(camera.position.clone().addScaledVector(tangent,.12).addScaledVector(normal,-.012));}
  else{camera.up.set(0,1,0);camera.position.copy(normal).multiplyScalar(radius*2.9);camera.lookAt(0,0,0);}}
pose();
document.querySelector('#winter')!.addEventListener('click',()=>{phase=winter;});document.querySelector('#summer')!.addEventListener('click',()=>{phase=summer;});
document.querySelector('#ground')!.addEventListener('click',()=>{ground=true;pose();});document.querySelector('#orbit')!.addEventListener('click',()=>{ground=false;pose();});
document.querySelector<HTMLInputElement>('#snow')!.onchange=e=>{for(const m of [terrain,scatter])m.uniforms.uSeasonalEnabled.value=(e.target as HTMLInputElement).checked?1:0;};
document.querySelector<HTMLInputElement>('#running')!.onchange=e=>{running=(e.target as HTMLInputElement).checked;};
renderer.setAnimationLoop(()=>{const now=performance.now();if(running)phase=(phase+(now-last)/20000)%1;last=now;
  for(const m of [terrain,scatter])m.uniforms.uSeasonalPhase.value=phase;
  const dir=camera.position.clone().normalize();manager.update(camera.position,field.heightAt(dir)/1000);renderer.render(scene,camera);
  const t=seasonalSurfaceTemperatureAt(seasonal.field,normal.y,phase*c.cycle.cycleSeconds);
  document.querySelector('#status')!.textContent=`${manager.outstanding?`Resolving ${manager.outstanding} tiles`:'Ready'} · phase ${(phase*100).toFixed(1)}% · ${t.toFixed(1)} K datum · ${renderer.info.render.triangles} triangles · ${manager.cachedChunks} cached · ${overlay.texture.version} uploads`;
});
