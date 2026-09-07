import { describe, expect, it } from 'vitest';
import { Quaternion, ShaderMaterial, Vector3 } from 'three';
import { AU,G,SOLAR_MASS } from '../../core/physics/constants';
import { mu } from '../../core/physics/units';
import type { Belt } from '../../universe/system/types';
import { beltCatalogue } from '../../universe/smallbody/beltRegion';
import { asteroidKey,createBeltPoints,updateBeltCatalogue,BELT_LOCAL_REACH_KM } from './beltPoints';
import { createBeltRegionPoints,finishBeltRegionPoints,writeBeltRegionPoint } from './beltRegionPoints';
const belt:Belt={kind:'main',innerAu:2,outerAu:3,inclinationDispersionRad:.1,gaps:[],resonantPopulations:[],
  inventory:{initialMassEarth:.0005,massEarth:.0005,bulkDensityKgM3:1800,minDiameterKm:.1,maxDiameterKm:1000,slope:2.3,collisionLifetimeMyr:10}};

describe('catalogue/local belt handoff',()=>{
  it('preserves orbit and luminosity attributes and hands over only admitted identities',()=>{
    const far=createBeltPoints(belt,42n,16,.7,1.2),local=createBeltRegionPoints(3.08e13,BELT_LOCAL_REACH_KM);
    const bodies=beltCatalogue(42n,belt,16),body=bodies[3];
    const epoch=92345;
    const lum=.7*body.albedo*(body.diameterKm/2/(body.elements.semiMajorAxis/1000))**2;
    writeBeltRegionPoint(local,0,body,mu(G*1.2*SOLAR_MASS),epoch,lum,true,true);finishBeltRegionPoints(local,1);
    const keys=new Set([asteroidKey(body)]),origin=new Vector3(),frame=new Quaternion();
    updateBeltCatalogue(far,epoch,0,origin,origin,frame,[1,1,1],keys,bodies[0]);
    for(const name of ['aOrbit0','aOrbit1']) {
      const f=far.geometry.getAttribute(name),l=local.geometry.getAttribute(name);
      expect([f.getX(3),f.getY(3),f.getZ(3),f.getW(3)]).toEqual([l.getX(0),l.getY(0),l.getZ(0),l.getW(0)]);
    }
    expect(far.geometry.getAttribute('aMeshReady').getX(3)).toBe(1);
    expect(far.geometry.getAttribute('aMeshReady').getX(4)).toBe(0);
    expect(far.geometry.getAttribute('aVisible').getX(0)).toBe(0);
    expect(far.geometry.getAttribute('aFlags').getY(3)).toBe(-1);
    updateBeltCatalogue(far,epoch+1,0,origin,origin,frame,[1,1,1],new Set(),null);
    expect(far.geometry.getAttribute('aMeshReady').getX(3)).toBe(0);
    expect(far.geometry.getAttribute('aVisible').getX(0)).toBe(1);
    expect(far.geometry.drawRange.count).toBe(16);
    for(const points of [far,local]) {points.geometry.dispose();(points.material as ShaderMaterial).dispose();}
  });
  it('cannot fabricate catalogue members for a zero-mass belt',()=>{
    const empty={...belt,inventory:{...belt.inventory!,massEarth:0}};
    const points=createBeltPoints(empty,12n,4500,1);
    expect(points.geometry.drawRange.count).toBe(0);
    points.geometry.dispose();(points.material as ShaderMaterial).dispose();
  });
});
