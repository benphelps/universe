import { describe, expect, it } from 'vitest';
import { generateSystem } from '../system/generate';
import { waterSaturationPa, waterBoilingK, WATER_TRIPLE_K, WATER_TRIPLE_PA, WATER_CRITICAL_K, WATER_CRITICAL_PA } from './waterPhase';

describe('pressure-dependent pure-water boundaries', () => {
  it('matches the IAPWS ice verification point and triple/critical endpoints', () => {
    expect(waterSaturationPa(230)).toBeCloseTo(8.94735, 5);
    expect(waterSaturationPa(WATER_TRIPLE_K - 1e-6)).toBeCloseTo(WATER_TRIPLE_PA, 3);
    expect(waterSaturationPa(WATER_TRIPLE_K)).toBeCloseTo(WATER_TRIPLE_PA, 1);
    expect(waterSaturationPa(WATER_CRITICAL_K)).toBe(WATER_CRITICAL_PA);
    expect(waterBoilingK(101325)).toBeCloseTo(373.124, 2);
    expect(waterBoilingK(1e4)).toBeCloseTo(318.96, 1);
  });
  it('does not extrapolate liquid coexistence into vacuum or supercritical states', () => {
    for (const p of [0, 45.4, 600, WATER_CRITICAL_PA + 1, Infinity, NaN]) expect(waterBoilingK(p)).toBeNull();
    for (const t of [0, 49.9, 648, Infinity, NaN]) expect(waterSaturationPa(t)).toBeNull();
    expect(waterBoilingK(WATER_TRIPLE_PA)).toBe(WATER_TRIPLE_K);
    let previous = 0;
    for (let t = 50; t <= 647; t++) {
      const p = waterSaturationPa(t)!;
      expect(p).toBeGreaterThan(previous); previous = p;
    }
  });
  it('cannot regenerate the reported low-pressure ocean on final field reconciliation', () => {
    const body = generateSystem(0xd50464b00652fab0n).planets[4].physical;
    expect(body.atmosphere.surfacePressureBar * 1e5).toBeLessThan(WATER_TRIPLE_PA);
    expect(body.climate.hydrosphere).not.toBe('oceans');
    expect(body.climate.oceanCoverage).toBe(0);
  });
});
