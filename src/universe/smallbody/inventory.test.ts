import { describe, expect, it } from 'vitest';
import { EARTH_MASS } from '../../core/physics/constants';
import { Rng } from '../../core/rng/rng';
import { generateDisk, diskMassBudget, diskSolidsBetween } from '../system/disk';
import { generateStar } from '../star/generate';
import type { Belt, BeltInventory } from '../system/types';
import { beltCollisionLifetimeMyr, beltDistribution, beltInventoryMoments, beltRankCount, beltRankDiameter } from './inventory';

const inventory: BeltInventory = { initialMassEarth:.0005,massEarth:.0005,bulkDensityKgM3:1800,
  minDiameterKm:.1,maxDiameterKm:1000,slope:2.3,collisionLifetimeMyr:0 };
const belt: Belt = {kind:'main',innerAu:2.1,outerAu:3.3,inclinationDispersionRad:.15,gaps:[],resonantPopulations:[],inventory};

describe('finite belt inventory', () => {
  it('integrates the same solid column across the frost line and clips disk edges', () => {
    const disk = generateDisk(new Rng(123n),generateStar(345n));
    expect(diskSolidsBetween(disk,0,Infinity)).toBeCloseTo(diskMassBudget(disk).solidEarth,10);
    expect(diskSolidsBetween(disk,0,disk.frostLineAu)+diskSolidsBetween(disk,disk.frostLineAu,Infinity))
      .toBeCloseTo(diskSolidsBetween(disk,0,Infinity),10);
    expect(diskSolidsBetween(disk,disk.outerAu,2*disk.outerAu)).toBe(0);
  });

  it('partitions both mass and cross section without inventing unresolved light', () => {
    const all = beltInventoryMoments(inventory), small = beltInventoryMoments(inventory,.1,6), large = beltInventoryMoments(inventory,6,1000);
    expect(all.massEarth).toBeCloseTo(inventory.massEarth,15);
    expect((small.massEarth+large.massEarth)/all.massEarth).toBeCloseTo(1,13);
    expect((small.crossSectionKm2+large.crossSectionKm2)/all.crossSectionKm2).toBeCloseTo(1,13);
    expect(small.count+large.count).toBeCloseTo(all.count,5);
    expect(beltDistribution({...inventory,massEarth:0})).toEqual({amplitude:0,count:0});
  });

  it('assigns ranks the exact integrated mass and keeps IDs independent of size floor', () => {
    // A modest finite population lets the test sum every concrete body.
    const spec = {...inventory,massEarth:1e-11,maxDiameterKm:2,minDiameterKm:.5};
    const count = Math.floor(beltDistribution(spec).count);
    let mass = 0, last = Infinity;
    for (let rank=0;rank<count;rank++) {
      const d = beltRankDiameter(spec,rank);
      expect(d).toBeLessThan(last); last=d;
      mass += spec.bulkDensityKgM3*Math.PI/6*(d*1000)**3/EARTH_MASS;
    }
    const {amplitude} = beltDistribution(spec);
    const boundary = (spec.maxDiameterKm**-spec.slope+spec.slope*count/amplitude)**(-1/spec.slope);
    expect(mass/spec.massEarth).toBeCloseTo(beltInventoryMoments(spec,boundary).massEarth/spec.massEarth,12);
    expect(mass).toBeLessThanOrEqual(spec.massEarth);
    expect(beltRankDiameter(spec,count)).toBe(0);
    for(const floor of [.5,.8,1,1.5,2]) {
      const n=beltRankCount(spec,floor);
      if(n>0) expect(beltRankDiameter(spec,n-1)).toBeGreaterThanOrEqual(floor);
      expect(beltRankDiameter(spec,n)).toBeLessThan(floor);
    }
  });

  it('has inverse-mass collision lifetime and slower depletion in a wider/distant annulus', () => {
    const tc = beltCollisionLifetimeMyr(belt,inventory,1);
    expect(tc).toBeGreaterThan(0); expect(Number.isFinite(tc)).toBe(true);
    expect(beltCollisionLifetimeMyr(belt,{...inventory,massEarth:inventory.massEarth*2},1)/tc).toBeCloseTo(.5,12);
    const outer = {...belt,innerAu:21,outerAu:33};
    expect(beltCollisionLifetimeMyr(outer,inventory,1)).toBeGreaterThan(tc*100);
  });
});
