import { describe, expect, it } from 'vitest';
import { planckRadiance } from '../../core/color/planck';
import { rgbLuminance } from '../../core/color/optical';
import { blackbodySurfaceEmission } from './thermalEmission';
import { SOLAR_IRRADIANCE_W_M2, SOLAR_OPTICAL_RGB_UNIT, surfaceBandRgb, surfaceLightExposure } from './surfaceRadiometry';
import { thermalLutSamples, THERMAL_LUT_SIZE, THERMAL_MIN_K, THERMAL_MAX_K } from './thermalMaterial';
import { SIGMA_SB } from '../../core/physics/constants';

function integratedVisibleFlux(t: number): number {
  let sum = 0;
  // Independent 0.25-nm quadrature, vs the response's 5-nm integration.
  for (let nm = 380.125; nm < 780; nm += .25) sum += Math.PI * planckRadiance(nm * 1e-9, t) * .25e-9;
  return sum;
}

describe('surface emission and reflected light', () => {
  it('retains the independently integrated optical power, including the Lambertian pi cancellation', () => {
    for (const t of [500, 700, 1000, 1400, 1800, 2200, 5000, 10000]) {
      const e = blackbodySurfaceEmission(t);
      const actual = rgbLuminance(e.color) * e.strength * SOLAR_OPTICAL_RGB_UNIT * SOLAR_IRRADIANCE_W_M2;
      expect(Math.abs(actual / integratedVisibleFlux(t) - 1)).toBeLessThan(.002);
    }
  });
  it('does not display room-temperature infrared power as visible glow', () => {
    expect(blackbodySurfaceEmission(300).strength * surfaceLightExposure(0)).toBeLessThan(1e-17);
    expect(blackbodySurfaceEmission(1800).strength).toBeGreaterThan(blackbodySurfaceEmission(1400).strength * 10);
    for (const t of [0, -1, NaN, Infinity]) expect(blackbodySurfaceEmission(t).strength).toBe(0);
  });
  it('adds emission and reflection linearly before the shared exposure', () => {
    const t = 1800, reflection = surfaceBandRgb(1, 5772), e = blackbodySurfaceEmission(t);
    const incoming = surfaceBandRgb(SIGMA_SB * t ** 4 / SOLAR_IRRADIANCE_W_M2, t);
    incoming.forEach((v, c) => expect(v).toBeCloseTo(e.color[c] * e.strength, 12));
    for (const exposure of [.01, 1, 100]) for (let c = 0; c < 3; c++) {
      const albedo = .2, emissivity = 1 - albedo;
      const combined = exposure * (reflection[c] * albedo + incoming[c] * emissivity);
      expect(combined).toBeCloseTo(exposure * reflection[c] * albedo + exposure * e.color[c] * e.strength * emissivity, 12);
    }
  });
  it('bounds the fragment lookup error without integrating spectra per pixel', () => {
    const samples = thermalLutSamples();
    expect(samples.byteLength).toBe(8192);
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      const t = THERMAL_MIN_K * (THERMAL_MAX_K / THERMAL_MIN_K) ** ((i + .37) / 2000);
      const coord = Math.log(t / THERMAL_MIN_K) / Math.log(THERMAL_MAX_K / THERMAL_MIN_K) * (THERMAL_LUT_SIZE - 1);
      const k = Math.floor(coord), f = coord - k;
      const at = (c: number) => samples[4*k+c]*(1-f)+samples[4*(k+1)+c]*f;
      const e = blackbodySurfaceEmission(t);
      for (let c=0;c<3;c++) worst = Math.max(worst, Math.abs(at(c) * Math.exp(at(3)) - e.color[c]*e.strength) / e.strength);
    }
    expect(worst).toBeLessThan(.001);
  });
});
