import { AU } from '../../core/physics/constants';
import { deriveSeed, seedToHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import type { Belt } from '../system/types';
import { buildAsteroid } from './asteroids';
import { beltRankCount, beltRankDiameter } from './inventory';
import type { Asteroid } from './types';

export const BELT_SECTORS = 256;
export const NOTABLE_DIAMETER_KM = 150;
export const BELT_CATALOGUE_LIMIT = 512;
const BODY_CACHE_LIMIT = 4096;

/** A power-of-two layout permits a cheap, exactly invertible rank map. */
export function beltBandCount(belt: Belt): number {
  return 2 ** Math.floor(Math.log2(Math.min(128, Math.max(8, (belt.outerAu - belt.innerAu) / .04))));
}

export function beltPopulationSeed(hostSeed: bigint, beltIndex: number): bigint {
  return deriveSeed(hostSeed, 'belt-population', beltIndex);
}

interface RadialSegment { lo: number; hi: number; weight: number; start: number; end: number }
const radialCache = new WeakMap<Belt, {segments: RadialSegment[]; total: number}>();
function radialProfile(belt: Belt) {
  let cached = radialCache.get(belt);
  if (cached) return cached;
  const edges = [belt.innerAu,belt.outerAu];
  for (const gap of belt.gaps) for (const sign of [-1,1]) {
    const edge = gap.semiMajorAxisAu + sign * gap.widthAu / 2;
    if (edge > belt.innerAu && edge < belt.outerAu) edges.push(edge);
  }
  edges.sort((a,b)=>a-b);
  const segments: RadialSegment[] = [];
  let total=0;
  for(let i=1;i<edges.length;i++) {
    const mid=(edges[i-1]+edges[i])/2;
    const weight=belt.gaps.some(gap=>Math.abs(mid-gap.semiMajorAxisAu)<gap.widthAu/2) ? .08 : 1;
    const lo=Math.sqrt(edges[i-1]),hi=Math.sqrt(edges[i]);
    const start=total; total+=(hi-lo)*weight;
    segments.push({lo,hi,weight,start,end:total});
  }
  cached={segments,total}; radialCache.set(belt,cached); return cached;
}

/** Normalized annular solid-column CDF (Sigma proportional to a^-1.5).
 * Gaps redistribute the same inventory rather than silently deleting it. */
export function beltRadialQuantile(belt: Belt, aAu: number): number {
  const {segments,total}=radialProfile(belt),x=Math.sqrt(Math.max(0,aAu));
  for(const segment of segments) if(x<segment.hi) {
    return Math.max(0,(segment.start+Math.max(0,x-segment.lo)*segment.weight)/total);
  }
  return 1;
}
export function beltSemiMajorAxis(belt: Belt, quantile: number): number {
  const {segments,total}=radialProfile(belt),target=Math.max(0,Math.min(1,quantile))*total;
  for(const s of segments) if(target<s.end) return (s.lo+(target-s.start)/s.weight)**2;
  return belt.outerAu;
}

const counts=new WeakMap<Belt,Map<number,number>>();
export function beltCountAbove(belt: Belt, diameterKm: number): number {
  if(!belt.inventory) return 0;
  let cache=counts.get(belt); if(!cache) {cache=new Map();counts.set(belt,cache);}
  const found=cache.get(diameterKm); if(found!==undefined) return found;
  const count=beltRankCount(belt.inventory,diameterKm);
  if(cache.size>=8) cache.clear(); cache.set(diameterKm,count); return count;
}

const MULTIPLIER=0x9e3779b1;
let inverse=1;
for(let i=0;i<5;i++) inverse=Math.imul(inverse,2-Math.imul(MULTIPLIER,inverse));
function unshift(value: number, step: number): number {
  let out=value; for(let s=step;s<32;s+=step) out^=value>>>s; return out;
}
function blockKey(seed: bigint,block: number,mask: number): number {
  let x=Number(seed&0xffffffffn)^Math.imul(block,0x85ebca6b);
  x^=x>>>16; x=Math.imul(x,0xc2b2ae35); x^=x>>>13; return x&mask;
}
function permute(slot: number,key: number,mask: number): number {
  let x=slot^key; x^=x>>>5; x=Math.imul(x,MULTIPLIER)&mask; return x^(x>>>7);
}
function unpermute(cell: number,key: number,mask: number): number {
  const x=Math.imul(unshift(cell,7),inverse)&mask; return unshift(x,5)^key;
}

/** Every rank maps to exactly one cell. Each complete block visits all
 * cells once, in a seeded permutation; lookup never scans the belt. */
export function beltCellForRank(beltSeed: bigint,belt: Belt,rank: number): {band:number;sector:number} {
  const size=beltBandCount(belt)*BELT_SECTORS,block=Math.floor(rank/size);
  const cell=permute(rank%size,blockKey(beltSeed,block,size-1),size-1);
  return {band:Math.floor(cell/BELT_SECTORS),sector:cell%BELT_SECTORS};
}

const bodies=new WeakMap<Belt,{seed:bigint;members:Map<number,Asteroid>}>();
export function beltMember(beltSeed: bigint,belt: Belt,rank: number): Asteroid | null {
  if(!belt.inventory) return null;
  let cache=bodies.get(belt);
  if(!cache || cache.seed!==beltSeed) {cache={seed:beltSeed,members:new Map()};bodies.set(belt,cache);}
  const found=cache.members.get(rank);
  if(found) {cache.members.delete(rank);cache.members.set(rank,found);return found;}
  const diameterKm=beltRankDiameter(belt.inventory,rank);
  if(!(diameterKm>0)) return null;
  const rng=new Rng(deriveSeed(beltSeed,'member',rank));
  const {band,sector}=beltCellForRank(beltSeed,belt,rank);
  const aAu=beltSemiMajorAxis(belt,(band+rng.float())/beltBandCount(belt));
  const asteroid=buildAsteroid(rng,belt,aAu,diameterKm);
  const longitude=(sector+rng.float())*2*Math.PI/BELT_SECTORS;
  const e=asteroid.elements;
  e.meanAnomalyAtEpoch=((longitude-e.longitudeOfAscendingNode-e.argumentOfPeriapsis)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
  asteroid.population={seedHex:seedToHex(beltSeed),rank};
  asteroid.bulkDensityKgM3=belt.inventory.bulkDensityKgM3;
  if(cache.members.size>=BODY_CACHE_LIMIT) cache.members.delete(cache.members.keys().next().value!);
  cache.members.set(rank,asteroid); return asteroid;
}

export function sameAsteroid(a: Asteroid | null,b: Asteroid | null): boolean {
  return a===b || !!(a?.population && b?.population && a.population.seedHex===b.population.seedHex && a.population.rank===b.population.rank);
}

/** Bounded largest-first materialization, stable under floor/limit changes.
 * A rendering limit omits fainter bodies; it never increases their light. */
export function beltCellAsteroids(beltSeed: bigint,belt: Belt,band: number,sector: number,minDiameterKm: number,limit=64): Asteroid[] {
  const bands=beltBandCount(belt); if(band<0 || band>=bands || limit<=0) return [];
  const size=bands*BELT_SECTORS,wrapped=((sector%BELT_SECTORS)+BELT_SECTORS)%BELT_SECTORS;
  const cell=band*BELT_SECTORS+wrapped,count=beltCountAbove(belt,minDiameterKm),out:Asteroid[]=[];
  for(let block=0;block*size<count && out.length<limit;block++) {
    const rank=block*size+unpermute(cell,blockKey(beltSeed,block,size-1),size-1);
    if(rank>=count) continue;
    const member=beltMember(beltSeed,belt,rank); if(member) out.push(member);
  }
  return out;
}

export function beltCatalogue(beltSeed:bigint,belt:Belt,limit=BELT_CATALOGUE_LIMIT,minKm=6):Asteroid[] {
  const count=Math.min(limit,beltCountAbove(belt,minKm)),out:Asteroid[]=[];
  for(let rank=0;rank<count;rank++) {const body=beltMember(beltSeed,belt,rank);if(body)out.push(body);}
  return out;
}

export function bandMeanMotion(belt:Belt,band:number,mu:number):number {
  const aAu=beltSemiMajorAxis(belt,(band+.5)/beltBandCount(belt));
  return Math.sqrt(mu/(aAu*AU)**3);
}
