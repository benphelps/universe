import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { AIR_VIEW_GLSL, airZenithRadianceGreen, type AirView } from './airView';

function earthAir(sunElevationRad: number, over: Partial<AirView> = {}): AirView {
  return {
    tau: [0.074, 0.13, 0.21],
    rayleighTau: [0.064, 0.1, 0.18],
    aerosolTau: [0.01, 0.03, 0.03],
    up: new Vector3(0, 1, 0),
    horizon: 35,
    aerosolHorizon: 16,
    refraction: 1,
    sunDir: new Vector3(Math.cos(sunElevationRad), Math.sin(sunElevationRad), 0),
    sunIntensity: 1,
    eclipse: 1,
    scatteringAlbedo: 0.98,
    ...over,
  };
}

describe('airZenithRadianceGreen', () => {
  it('is nothing in a vacuum or without a sun', () => {
    expect(airZenithRadianceGreen(earthAir(1, { tau: [0, 0, 0] }))).toBe(0);
    expect(airZenithRadianceGreen(earthAir(1, { sunIntensity: 0 }))).toBe(0);
  });

  it('is a few percent of a sunlit white ground under a high sun', () => {
    const noon = airZenithRadianceGreen(earthAir(Math.PI / 2));
    expect(noon).toBeGreaterThan(0.01);
    expect(noon).toBeLessThan(0.1);
    expect(airZenithRadianceGreen(earthAir(0.05))).toBeGreaterThan(0);
  });

  it('scales with the sun and darkens under an eclipse', () => {
    const clear = airZenithRadianceGreen(earthAir(1));
    expect(airZenithRadianceGreen(earthAir(1, { sunIntensity: 0.5 }))).toBeCloseTo(clear / 2, 9);
    expect(airZenithRadianceGreen(earthAir(1, { eclipse: 0.1 }))).toBeCloseTo(clear * 0.1, 9);
  });
});

describe('eclipse background contrast', () => {
  it('uses the observer eclipse fraction without inventing a directional cutout', () => {
    expect(AIR_VIEW_GLSL).toContain('float eclipseLight = uAirEclipse;');
    expect(AIR_VIEW_GLSL).not.toContain('overheadShare');
  });
});
