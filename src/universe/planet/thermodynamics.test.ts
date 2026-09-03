import { describe, expect, it } from 'vitest';
import type { PlanetAtmosphere, PlanetBulk, PlanetClimate } from './types';
import {
  atmosphericTemperatureK,
  condensationLayer,
  exposedMagmaTemperatureK,
  globalSilicateMeltFraction,
  silicateMeltFraction,
  skinTemperatureK,
} from './thermodynamics';

const BULK: PlanetBulk = {
  massEarth: 1,
  radiusEarth: 1,
  densityGcc: 5.5,
  gravityMs2: 9.81,
  escapeVelocityKms: 11.2,
  oblateness: 0,
};
const AIR: PlanetAtmosphere = {
  class: 'co2-hothouse',
  surfacePressureBar: 90,
  scaleHeightKm: 7,
  opticalDepth: 1,
  scatteringColor: [1, 1, 1],
};
const CLIMATE: PlanetClimate = {
  equilibriumK: 230,
  surfaceMeanK: 730,
  bondAlbedo: 0.7,
  iceCapLatitudeRad: Math.PI / 2,
  hydrosphere: 'none',
  oceanCoverage: 0,
  dayNightDeltaK: 0,
  snowball: false,
  biosphere: false,
  co2Bar: 0,
};

describe('atmospheric thermodynamics', () => {
  it('follows an adiabat down to the gray radiative ceiling', () => {
    expect(atmosphericTemperatureK(AIR, CLIMATE, BULK, 0)).toBe(730);
    expect(atmosphericTemperatureK(AIR, CLIMATE, BULK, 1000)).toBeCloseTo(
      skinTemperatureK(CLIMATE.equilibriumK),
    );
  });

  it('finds a temperate acid layer on a Venus-like profile', () => {
    const layer = condensationLayer(AIR, CLIMATE, BULK, { coldK: 230, warmK: 430 });
    expect(layer).not.toBeNull();
    expect(layer!.baseAltitudeKm).toBeGreaterThan(20);
    expect(layer!.topAltitudeKm).toBeGreaterThan(layer!.baseAltitudeKm);
  });

  it('rejects acid when even the radiative ceiling is too hot', () => {
    const hot = { ...CLIMATE, equilibriumK: 883, surfaceMeanK: 2680 };
    expect(condensationLayer(AIR, hot, BULK, { coldK: 230, warmK: 430 })).toBeNull();
  });

  it('derives melt continuously from the silicate phase interval', () => {
    expect(silicateMeltFraction(1200)).toBe(0);
    expect(silicateMeltFraction(1550)).toBeCloseTo(0.5);
    expect(silicateMeltFraction(1800)).toBe(1);
    expect(silicateMeltFraction(2200)).toBe(1);
  });

  it('uses the phase interval for exposed internally heated melt', () => {
    expect(exposedMagmaTemperatureK(300, 0.2)).toBe(1400);
    expect(exposedMagmaTemperatureK(2100, 1)).toBe(2100);
  });

  it('freezes the night side of a high-contrast locked lava world', () => {
    expect(globalSilicateMeltFraction(2600, 0)).toBe(1);
    const locked = globalSilicateMeltFraction(1550, 1200);
    expect(locked).toBeGreaterThan(0.25);
    expect(locked).toBeLessThan(0.75);
  });
});
