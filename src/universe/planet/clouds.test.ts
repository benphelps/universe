import { describe, expect, it } from 'vitest';
import { Rng } from '../../core/rng/rng';
import { computeCloudLayer } from './clouds';
import type {
  PlanetAtmosphere,
  PlanetBulk,
  PlanetClimate,
  PlanetRotation,
} from './types';

const BULK: PlanetBulk = {
  massEarth: 1,
  radiusEarth: 1,
  densityGcc: 5.5,
  gravityMs2: 9.8,
  escapeVelocityKms: 11.2,
  oblateness: 0.003,
};
const ROTATION: PlanetRotation = {
  periodHours: 24,
  obliquityRad: 0.4,
  locked: false,
  spinOrbitResonance: null,
};
const CLIMATE: PlanetClimate = {
  equilibriumK: 255,
  surfaceMeanK: 288,
  bondAlbedo: 0.3,
  iceCapLatitudeRad: 1.2,
  hydrosphere: 'oceans',
  oceanCoverage: 0.7,
  dayNightDeltaK: 0,
  snowball: false,
  biosphere: true,
  co2Bar: 0.0004,
};

function atmosphere(
  atmosphereClass: PlanetAtmosphere['class'],
  scaleHeightKm = 8,
): PlanetAtmosphere {
  return {
    class: atmosphereClass,
    surfacePressureBar: 1,
    scaleHeightKm,
    opticalDepth: 1,
    scatteringColor: [0.4, 0.6, 1],
  };
}

describe('solid-world cloud layers', () => {
  it('keeps aerosol haze separate from condensate clouds', () => {
    const titan = computeCloudLayer(
      new Rng(1n),
      atmosphere('nitrogen-methane', 18),
      { ...CLIMATE, surfaceMeanK: 94, hydrosphere: 'none' },
      BULK,
      ROTATION,
    );
    expect(titan.condensate).toBe('methane');
    expect(titan.coverage).toBeGreaterThan(0);
    expect(titan.coverage).toBeLessThan(0.2);
    expect(titan.color[0]).toBeCloseTo(titan.color[2], 1);
  });

  it('puts a hothouse acid deck high and optically thick', () => {
    const venus = computeCloudLayer(
      new Rng(2n),
      atmosphere('co2-hothouse', 5),
      { ...CLIMATE, surfaceMeanK: 730, hydrosphere: 'none' },
      BULK,
      { ...ROTATION, periodHours: 5800 },
    );
    expect(venus.condensate).toBe('sulfuric-acid');
    expect(venus.coverage).toBe(1);
    expect(venus.topAltitudeKm).toBeGreaterThanOrEqual(50);
    expect(venus.opticalDepth).toBeGreaterThan(20);
  });

  it('gives ocean worlds more clouds and deeper relief than frozen ones', () => {
    const ocean = computeCloudLayer(
      new Rng(3n),
      atmosphere('nitrogen'),
      CLIMATE,
      BULK,
      ROTATION,
    );
    const frozen = computeCloudLayer(
      new Rng(3n),
      atmosphere('nitrogen'),
      { ...CLIMATE, surfaceMeanK: 230, hydrosphere: 'ice-sheet', oceanCoverage: 0 },
      BULK,
      ROTATION,
    );
    expect(ocean.coverage).toBeGreaterThan(frozen.coverage);
    expect(ocean.relief).toBeGreaterThan(frozen.relief);
    expect(ocean.opticalDepth).toBeGreaterThan(frozen.opticalDepth);
  });

  it('anchors condensate toward the physically favored hemisphere on locked worlds', () => {
    const wet = computeCloudLayer(
      new Rng(4n),
      atmosphere('nitrogen'),
      CLIMATE,
      BULK,
      { ...ROTATION, locked: true, periodHours: 300 },
    );
    const vapor = computeCloudLayer(
      new Rng(4n),
      atmosphere('rock-vapor'),
      { ...CLIMATE, surfaceMeanK: 1600, hydrosphere: 'magma' },
      BULK,
      { ...ROTATION, locked: true, periodHours: 300 },
    );
    expect(wet.stellarBias).toBeGreaterThan(0);
    expect(vapor.stellarBias).toBeLessThan(0);
  });
});
