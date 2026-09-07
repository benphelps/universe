import { describe, expect, it } from 'vitest';
import { columnStateAt, type HydrostaticColumn } from '../../universe/planet/hydrostaticColumn';
import { gasProfile, gasState } from './gasProfile';
import { airSegmentColumn, slantColumn } from './surfaceLight';

describe('shared optical gas profile', () => {
  for (const cap of [288, 215, 100]) it(`preserves pressure, density and column mass with a ${cap} K cap`, () => {
    const column: HydrostaticColumn = { surfacePressurePa: 1e5, surfaceTemperatureK: 288,
      capTemperatureK: cap, lapseKPerM: 9.81 / 1005, gasConstantJkgK: 287, gravityMs2: 9.81 };
    const profile = gasProfile(column), h = 287 * 288 / 9.81;
    const ground = columnStateAt(column, 0);
    for (const x of [0, 1e-7, 0.001, 0.5, 1, 3, 5, 15]) {
      const state = columnStateAt(column, x * h), optical = gasState(profile, x);
      expect(optical[0]).toBeCloseTo(state.pressureFraction, 12);
      expect(optical[1]).toBeCloseTo(state.densityKgM3 / ground.densityKgM3, 12);
      expect(slantColumn(x * h / 1000, 1, 6371, h / 1000, profile)).toBeCloseTo(state.pressureFraction, 5);
    }
    // Independent integrated ray density must recover the hydrostatic mass.
    let integrated = 0;
    const step = 20 / 8192;
    for (let i = 0; i < 8192; i++) integrated += gasState(profile, (i + 0.5) * step)[1] * step;
    expect(integrated).toBeCloseTo(1, 5);
    const vertical = airSegmentColumn(1, h, 35, 0, 2 * h, 2 * h, profile);
    expect(vertical).toBeCloseTo(1 - columnStateAt(column, 2 * h).pressureFraction, 12);
    const horizontal = airSegmentColumn(1, h, 35, h, h, 10, profile);
    expect(horizontal).toBeCloseTo(gasState(profile, 1)[1] * 10 / h, 12);
  });
  it('retains the exponential limit for envelopes and isothermal fixtures', () => {
    for (const x of [0, 0.1, 1, 4, 20]) expect(gasState(undefined, x)).toEqual([Math.exp(-x), Math.exp(-x)]);
  });
});
