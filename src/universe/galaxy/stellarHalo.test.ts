import { describe, expect, it } from 'vitest';
import { stellarHaloCount, stellarHaloDensity, STELLAR_HALO_MODEL as m } from './stellarHalo';
import { fieldPopulationMoments } from './fieldPopulation';
import { smoothComponentDensities, stellarDensityCeiling, stellarDensity } from './density';

describe('the mass-calibrated stellar halo', () => {
  it('matches local mass density and a finite Milky-Way-like integrated mass', () => {
    const mean = fieldPopulationMoments('halo').massSolar;
    expect(stellarHaloDensity(8000, 0) * mean).toBeCloseTo(6.9e-5, 14);
    const mass = stellarHaloCount() * mean;
    // Independent reference envelope: smooth MW halo ~1.2 +/- 0.3e9 Msun.
    expect(mass).toBeGreaterThan(.9e9);
    expect(mass).toBeLessThan(1.5e9);
    expect(stellarHaloCount(100000) / stellarHaloCount()).toBeGreaterThan(.94);
    expect(stellarHaloCount()).toBeLessThan(7e9); // former accidental 48e9 objects
  });

  it('has continuous density, oblate isosurfaces and both measured radial slopes', () => {
    for (const r of [m.corePc, m.breakPc]) {
      expect(stellarHaloDensity(r * (1-1e-8), 0) / stellarHaloDensity(r * (1+1e-8), 0)).toBeCloseTo(1, 6);
    }
    for (const r of [200, 2000, 12000, 90000]) {
      expect(stellarHaloDensity(0, r * m.flattening)).toBeCloseTo(stellarHaloDensity(r, 0), 12);
    }
    expect(stellarHaloDensity(4000, 0) / stellarHaloDensity(2000, 0)).toBeCloseTo(2 ** -2.3, 12);
    expect(stellarHaloDensity(80000, 0) / stellarHaloDensity(40000, 0)).toBeCloseTo(2 ** -4.6, 12);
    expect(Number.isFinite(stellarHaloDensity(0, 0))).toBe(true);
  });

  it('integrates the actual density with its ellipsoidal volume and preserves cell ceilings', () => {
    for (const maxR of [100, 500, 8000, 27000, 100000, 1e8]) {
      let count=0;
      const lo=.001, steps=10000, dlog=Math.log(maxR/lo)/steps;
      for(let i=0;i<steps;i++) {
        const a=lo*Math.exp(i*dlog),b=a*Math.exp(dlog),r=Math.sqrt(a*b);
        count+=stellarHaloDensity(r,0)*4*Math.PI*m.flattening*(b**3-a**3)/3;
      }
      expect(count/stellarHaloCount(maxR)).toBeCloseTo(1,5);
    }
    for(const p of [{xPc:-200,yPc:100,zPc:-20},{xPc:26000,yPc:0,zPc:2000},{xPc:-100,yPc:50,zPc:20000}]) {
      const ceiling=stellarDensityCeiling(p,1000);
      for(let i=0;i<20;i++) {
        const point={xPc:p.xPc+i*50,yPc:p.yPc+(i*113)%1000,zPc:p.zPc+(i*219)%1000};
        expect(smoothComponentDensities(point).halo).toBe(stellarHaloDensity(Math.hypot(point.xPc,point.yPc),Math.abs(point.zPc)));
        expect(stellarDensity(point)).toBeLessThanOrEqual(ceiling);
      }
    }
  });
});
