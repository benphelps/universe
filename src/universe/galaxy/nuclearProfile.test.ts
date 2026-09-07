import { expect, it } from 'vitest';
import { buildNuclearColumnTable, nuclearColumnAt, nuclearProfileCdf, nuclearProfileDensity, nuclearProfileRadius,
  nuclearRayColumn, NUCLEAR_CORE, NUCLEAR_TRUNCATION, NUCLEAR_HELD_FRACTION } from './nuclearProfile';

function integrate(f:(x:number)=>number, lo:number, hi:number, n=10000):number {
  let sum=0;for(let i=0;i<n;i++)sum+=f(lo+(i+.5)*(hi-lo)/n);return sum*(hi-lo)/n;
}
it('regularizes only the tiny cusp, matching its mass, density and slope',()=>{
  const coreMass=(NUCLEAR_CORE/(1+NUCLEAR_CORE))**2/NUCLEAR_HELD_FRACTION;
  expect(nuclearProfileCdf(NUCLEAR_CORE)).toBeCloseTo(coreMass,15);
  expect(integrate(r=>4*Math.PI*r*r*nuclearProfileDensity(r),0,NUCLEAR_CORE)/coreMass).toBeCloseTo(1,7);
  expect(nuclearProfileDensity(0)).toBeGreaterThan(0);
  expect(Math.abs(nuclearProfileDensity(NUCLEAR_CORE*(1-1e-6))/nuclearProfileDensity(NUCLEAR_CORE*(1+1e-6))-1)).toBeLessThan(3e-6);
  const step=NUCLEAR_CORE*1e-5, edge=nuclearProfileDensity(NUCLEAR_CORE);
  const inside=(edge-nuclearProfileDensity(NUCLEAR_CORE-step))/step;
  const outside=(nuclearProfileDensity(NUCLEAR_CORE+step)-edge)/step;
  expect(Math.abs(inside/outside-1)).toBeLessThan(1e-4);
  for(const u of [0,1e-10,1e-7,1e-6,.001,.3,.999,1]) expect(nuclearProfileCdf(nuclearProfileRadius(u))).toBeCloseTo(u,12);
});
it('integrates a unit luminosity and agrees with an independent line quadrature',()=>{
  const table=buildNuclearColumnTable();
  const total=integrate(t=>{
    const b=Math.expm1(t)*NUCLEAR_CORE;
    return 4*Math.PI*b*nuclearColumnAt(table,b,NUCLEAR_TRUNCATION)*(b+NUCLEAR_CORE);
  },0,Math.log1p(NUCLEAR_TRUNCATION/NUCLEAR_CORE));
  expect(Math.abs(total-1)).toBeLessThan(.0015);
  for(const b of [0,.0003,.001,.02,.4,1,4,8]) {
    const end=Math.sqrt(NUCLEAR_TRUNCATION**2-b*b);
    const reference=integrate(t=>{
      const z=Math.expm1(t)*NUCLEAR_CORE;
      return nuclearProfileDensity(Math.hypot(b,z))*(z+NUCLEAR_CORE);
    },0,Math.log1p(end/NUCLEAR_CORE));
    expect(Math.abs(nuclearColumnAt(table,b,end)/reference-1)).toBeLessThan(.003);
    expect(nuclearRayColumn(table,b,-20)).toBeCloseTo(2*nuclearColumnAt(table,b,end),12);
    expect(nuclearRayColumn(table,b,20)).toBe(0);
    expect(nuclearRayColumn(table,b,-2)+nuclearRayColumn(table,b,2)).toBeCloseTo(2*nuclearColumnAt(table,b,end),12);
  }
});
it('debits excised subpixel light from the extended profile exactly once',()=>{
  const table=buildNuclearColumnTable();
  for(const cut of [.02,.4,2,12]) {
    const remaining=integrate(t=>{
      const b=Math.expm1(t)*NUCLEAR_CORE;
      return 2*Math.PI*b*nuclearRayColumn(table,b,-20,cut)*(b+NUCLEAR_CORE);
    },0,Math.log1p(NUCLEAR_TRUNCATION/NUCLEAR_CORE));
    expect(Math.abs(remaining+nuclearProfileCdf(cut)-1)).toBeLessThan(.0015);
  }
});
