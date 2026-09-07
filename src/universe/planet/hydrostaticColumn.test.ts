import { expect, it } from 'vitest';
import { columnAltitudeAtPressureFraction, columnStateAt, sampleHydrostaticColumn, type HydrostaticColumn } from './hydrostaticColumn';
const earth: HydrostaticColumn = { surfacePressurePa: 101325, surfaceTemperatureK: 288.15, capTemperatureK: 216.65,
  gravityMs2: 9.80665, gasConstantJkgK: 287.05, lapseKPerM: 0.0065 };

it('recovers the independent isothermal and standard tropospheric barometric limits', () => {
  const iso = { ...earth, lapseKPerM: 0 };
  for (const z of [0, 100, 1000, 10000, 50000]) {
    expect(columnStateAt(iso, z).pressureFraction).toBeCloseTo(Math.exp(-earth.gravityMs2 * z / (earth.gasConstantJkgK * earth.surfaceTemperatureK)), 12);
  }
  // Analytic standard-atmosphere anchor at the 11-km tropopause.
  const top = columnStateAt(earth, 11000);
  expect(top.temperatureK).toBeCloseTo(216.65, 10);
  expect(top.pressurePa).toBeGreaterThan(22630);
  expect(top.pressurePa).toBeLessThan(22634);
});

it('satisfies hydrostatic balance and the ideal gas law across both thermal branches', () => {
  for (const gasR of [188.9, 287.05, 3600]) for (const g of [1.5, 9.81, 30]) {
    const c = { ...earth, gasConstantJkgK: gasR, gravityMs2: g };
    for (const z of [0.1, 100, 10000, 10999, 11001, 30000]) {
      const state = columnStateAt(c,z);
      const dpdz = (columnStateAt(c,z+0.01).pressurePa-columnStateAt(c,z-0.01).pressurePa)/0.02;
      expect(Math.abs(dpdz / (-state.densityKgM3*g)-1)).toBeLessThan(1e-7);
      expect(state.densityKgM3*gasR*state.temperatureK/state.pressurePa).toBeCloseTo(1,12);
    }
  }
});

it('inverts pressure smoothly and keeps the surface and isothermal-cap limits', () => {
  for (const lapse of [0,1e-12,earth.lapseKPerM]) for (const cap of [216.65,earth.surfaceTemperatureK]) {
    const c={...earth,lapseKPerM:lapse,capTemperatureK:cap};
    for (const f of [1,0.999999999,0.1,1e-3,1e-6]) {
      expect(columnStateAt(c,columnAltitudeAtPressureFraction(c,f)).pressureFraction/f).toBeCloseTo(1,9);
    }
  }
  const base=columnStateAt(earth,0);expect(base.pressurePa).toBe(earth.surfacePressurePa);
  expect(columnStateAt(earth,-100)).toEqual(base);
});

it('preserves the gas mass under pressure-layer refinement and independent altitude integration', () => {
  const expected=earth.surfacePressurePa/earth.gravityMs2;
  for(const layers of [16,32,64]) {
    const sampled=sampleHydrostaticColumn(earth,layers);
    expect(sampled.massKgM2.reduce((s,v)=>s+v,0)/expected).toBeCloseTo(1-1e-6,12);
    for(let i=1;i<=layers;i++) {
      expect(sampled.altitudeM[i]).toBeGreaterThan(sampled.altitudeM[i-1]);
      expect(sampled.pressurePa[i]).toBeLessThan(sampled.pressurePa[i-1]);
    }
  }
  let integrated=0;const dz=2;
  for(let z=dz/2;z<150000;z+=dz) integrated+=columnStateAt(earth,z).densityKgM3*dz;
  expect(Math.abs(integrated/expected-1)).toBeLessThan(1e-8);
});
