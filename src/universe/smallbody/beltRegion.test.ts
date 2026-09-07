import { describe, expect, it } from 'vitest';
import { AU } from '../../core/physics/constants';
import type { Belt } from '../system/types';
import { beltCatalogue, beltCellAsteroids, beltCellForRank, beltBandCount, BELT_SECTORS,
  beltMember, beltRadialQuantile, beltSemiMajorAxis, sameAsteroid } from './beltRegion';

const belt:Belt={kind:'main',innerAu:2.1,outerAu:3.3,inclinationDispersionRad:.15,
  gaps:[{semiMajorAxisAu:2.5,widthAu:.05,resonance:'3:1'}],resonantPopulations:[],
  inventory:{initialMassEarth:.0005,massEarth:.0005,bulkDensityKgM3:1800,minDiameterKm:.1,maxDiameterKm:1000,slope:2.3,collisionLifetimeMyr:100}};

describe('one addressable belt population',()=>{
  it('maps every rank block bijectively to cells and finds members without scanning the population',()=>{
    const size=beltBandCount(belt)*BELT_SECTORS;
    for(const block of [0,1,4]) {
      const cells=new Set<number>();
      for(let i=0;i<size;i++) {
        const {band,sector}=beltCellForRank(42n,belt,block*size+i);
        cells.add(band*BELT_SECTORS+sector);
      }
      expect(cells.size).toBe(size);
    }
    for(const rank of [0,1,70,511,size+117,4*size+83]) {
      const {band,sector}=beltCellForRank(42n,belt,rank);
      const members=beltCellAsteroids(42n,belt,band,sector,1,8);
      const found=members.find(body=>body.population!.rank===rank);
      expect(found).toEqual(beltMember(42n,belt,rank));
      expect(beltCellAsteroids(42n,belt,band,sector+BELT_SECTORS,1,8)).toEqual(members);
    }
  });
  it('uses the same bodies across catalogue, cell floor changes and cache eviction',()=>{
    const top=beltCatalogue(42n,belt,64);
    expect(new Set(top.map(body=>body.shape.noiseSeedHex)).size).toBe(top.length);
    const original=structuredClone(top[31]);
    for(let i=100;i<4300;i++) beltMember(42n,belt,i);
    const restored=beltMember(42n,belt,31)!;
    expect(restored).toEqual(original); expect(sameAsteroid(restored,original)).toBe(true);
    const cell=beltCellForRank(42n,belt,31);
    const small=beltCellAsteroids(42n,belt,cell.band,cell.sector,1,5);
    const large=beltCellAsteroids(42n,belt,cell.band,cell.sector,6,5);
    expect(large[0]).toEqual(small[0]);
    expect(beltCellAsteroids(42n,belt,cell.band,cell.sector,1,2)).toEqual(small.slice(0,2));
    expect(beltCatalogue(42n,{...belt,inventory:undefined})).toEqual([]);
  });
  it('samples the same normalized radial column and epoch longitude used by cell lookup',()=>{
    for(let i=0;i<=100;i++) {
      const u=i/100; expect(beltRadialQuantile(belt,beltSemiMajorAxis(belt,u))).toBeCloseTo(u,12);
    }
    const members=beltCatalogue(99n,belt,512), bands=beltBandCount(belt);
    for(const body of members) {
      const cell=beltCellForRank(99n,belt,body.population!.rank),e=body.elements;
      const band=Math.floor(beltRadialQuantile(belt,e.semiMajorAxis/AU)*bands);
      const longitude=(e.meanAnomalyAtEpoch+e.argumentOfPeriapsis+e.longitudeOfAscendingNode)%(2*Math.PI);
      expect(band).toBe(cell.band); expect(Math.floor(longitude/(2*Math.PI)*BELT_SECTORS)).toBe(cell.sector);
    }
  });
});
