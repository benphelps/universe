import { Points, Quaternion, Vector3 } from 'three';
import { AU, G, SOLAR_MASS } from '../../core/physics/constants';
import { mu, type Mu } from '../../core/physics/units';
import { seedFromHex } from '../../core/rng/hash';
import { beltCatalogue, beltPopulationSeed, BELT_CATALOGUE_LIMIT, sameAsteroid } from '../../universe/smallbody/beltRegion';
import type { Asteroid } from '../../universe/smallbody/types';
import type { Belt } from '../../universe/system/types';
import { createBeltRegionPoints, finishBeltRegionPoints, setBeltRegionHiddenSlots,
  setBeltRegionResolvedSlots, updateBeltRegionPointFrame, writeBeltRegionPoint } from './beltRegionPoints';

const AU_KM=AU/1000;
const PC_KM=3.0856775814913673e13;
export const BELT_LOCAL_REACH_KM=.35*1.5*AU_KM;
interface CatalogueState {
  bodies:Asteroid[]; mu:Mu; luminosity:number; epochDays:number;
  localKeys?:ReadonlySet<string>; focused?:Asteroid|null;
}
const catalogues=new WeakMap<Points,CatalogueState>();

export function asteroidKey(body:Asteroid):string {
  return body.population ? `${body.population.seedHex}:${body.population.rank}` : body.shape.noiseSeedHex;
}

/** Same actual largest members, Kepler shader and light law as local
 * streaming. This is a bounded selection, not weighted fake rocks. */
export function createBeltPoints(belt:Belt,beltSeed:bigint,count:number,hostLuminosity:number,centralMassSolar=1):Points {
  const bodies=beltCatalogue(beltSeed,belt,Math.min(count,BELT_CATALOGUE_LIMIT));
  const points=createBeltRegionPoints(PC_KM,BELT_LOCAL_REACH_KM,Math.max(1,bodies.length));
  const state={bodies,mu:mu(G*centralMassSolar*SOLAR_MASS),luminosity:hostLuminosity,epochDays:NaN};
  catalogues.set(points,state);
  rewrite(points,state,0);
  return points;
}
function rewrite(points:Points,state:CatalogueState,epochDays:number):void {
  state.bodies.forEach((body,i)=>{
    const radiusKm=body.diameterKm/2,aKm=body.elements.semiMajorAxis/1000;
    const luminosity=state.luminosity*body.albedo*(radiusKm/aKm)**2;
    writeBeltRegionPoint(points,i,body,state.mu,epochDays,luminosity,true,false);
    points.geometry.getAttribute('aFlags').setY(i,-1);
  });
  finishBeltRegionPoints(points,state.bodies.length);
  state.epochDays=epochDays;
}
export function createBeltPointsForSystem(belts:Belt[],hostSeedHex:string,hostLuminosity:number,centralMassSolar=1):Points[] {
  return belts.map((belt,i)=>createBeltPoints(belt,beltPopulationSeed(seedFromHex(hostSeedHex),i),BELT_CATALOGUE_LIMIT,hostLuminosity,centralMassSolar));
}

/** Coarse/local epochs match exactly. Rebase attributes only with the
 * streamed population; per-frame updates carry shared transforms. */
export function updateBeltCatalogue(points:Points,epochDays:number,elapsedDays:number,focus:Vector3,host:Vector3,frame:Quaternion,
  color:readonly[number,number,number],localKeys:ReadonlySet<string>,focused:Asteroid|null):void {
  const state=catalogues.get(points); if(!state) return;
  const rewritten=epochDays!==state.epochDays;
  if(rewritten) rewrite(points,state,epochDays);
  updateBeltRegionPointFrame(points,elapsedDays,focus,host,frame,color);
  if(!rewritten && localKeys===state.localKeys && focused===state.focused) return;
  state.localKeys=localKeys; state.focused=focused;
  const local:number[]=[],hidden:number[]=[];
  state.bodies.forEach((body,i)=>{
    if(sameAsteroid(body,focused)) hidden.push(i);
    else if(localKeys.has(asteroidKey(body))) local.push(i);
  });
  setBeltRegionResolvedSlots(points,local);
  setBeltRegionHiddenSlots(points,hidden);
}
