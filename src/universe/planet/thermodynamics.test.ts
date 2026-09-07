import { describe, expect, it } from 'vitest';
import type { PlanetAtmosphere, PlanetBulk, PlanetClimate } from './types';
import {
  atmosphericTemperatureK,
  atmosphericColumnProfile,
  condensationLayer,
  exposedMagmaTemperatureK,
  globalSilicateMeltFraction,
  silicateMeltFraction,
  skinTemperatureK,
  surfaceThermalState,
} from './thermodynamics';
import { SIGMA_SB } from '../../core/physics/constants';
import { atmosphereAtTemperature } from './atmosphere';
import { columnStateAt } from './hydrostaticColumn';

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
  it('derives the column from the final mixture and matches its reference scale height and lapse', () => {
    const climate = { ...CLIMATE, surfaceMeanK: 288, equilibriumK: 255 };
    const air = atmosphereAtTemperature({ ...AIR, class: 'nitrogen-oxygen', surfacePressureBar: 1 }, 288, BULK);
    const c = atmosphericColumnProfile(air, climate, BULK)!;
    expect(c.regime).toBe('dry-ideal-gas');
    expect(c.gasConstantJkgK * 288 / c.gravityMs2 / 1000).toBeCloseTo(air.scaleHeightKm, 12);
    expect(c.lapseKPerM * c.specificHeatJkgK).toBeCloseTo(BULK.gravityMs2, 12);
    for (const z of [0, 1, 5, 10, 100]) {
      expect(columnStateAt(c, z * 1000).temperatureK).toBe(atmosphericTemperatureK(air, climate, BULK, z));
    }
    expect(atmosphericColumnProfile(AIR, CLIMATE, BULK)!.regime).toBe('extrapolated-ideal-gas');
    expect(atmosphericColumnProfile({ ...air, class: 'none' }, climate, BULK)).toBeNull();
    expect(atmosphericColumnProfile({ ...air, class: 'hydrogen-helium' }, climate, BULK)).toBeNull();
    expect(atmosphericColumnProfile(air, climate, { ...BULK, gravityMs2: 0 })).toBeNull();
  });

  it('preserves cold local surface boundaries instead of heating them up to a global skin floor', () => {
    const c = atmosphericColumnProfile(AIR, CLIMATE, BULK, 150)!;
    expect(columnStateAt(c, 0).temperatureK).toBe(150);
    expect(columnStateAt(c, 10000).temperatureK).toBe(150);
  });

  it('truncates candidate clouds at the pressure ceiling of their actual thermal profile', () => {
    const air = { ...AIR, scaleHeightKm: 0.5 };
    const layer = condensationLayer(air, CLIMATE, BULK, { warmK: 729, coldK: 200 })!;
    const column = atmosphericColumnProfile(air, CLIMATE, BULK)!;
    expect(columnStateAt(column, layer.topAltitudeKm * 1000).pressureFraction).toBeCloseTo(1e-6, 12);
    expect(layer.topAltitudeKm).toBeLessThan(air.scaleHeightKm * Math.log(1e6));
  });

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

  it('does not derive a hotspot temperature from its area', () => {
    expect(exposedMagmaTemperatureK(300, 0.2)).toBe(1800);
    expect(exposedMagmaTemperatureK(2100, 1)).toBe(2100);
  });

  it('conserves area-weighted radiative power for cold volcanism, hot surfaces and greenhouse columns', () => {
    for (const eq of [14.5, 250, 1200, 1550, 2200]) for (const heat of [0, 0.09, 2.5, 88.57, 1e6]) for (const tau of [0, 0.1, 20]) for (const contrast of [0, 800]) {
      const t = surfaceThermalState(eq, heat, tau, contrast);
      const f = t.meltCoverage;
      const outgoing = SIGMA_SB * ((1 - f) * t.surfaceBackgroundK ** 4 + f * t.magmaTemperatureK ** 4) / (1 + 0.75 * tau);
      const incoming = SIGMA_SB * eq ** 4 + heat;
      expect(outgoing / incoming).toBeCloseTo(1, 10);
      expect(t.surfaceMeanK).toBeGreaterThanOrEqual(0);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the audited cold volcanic moon mostly solid and includes giant intrinsic heat', () => {
    const moon = surfaceThermalState(14.5, 88.57, 0);
    expect(moon.meltCoverage).toBeLessThan(0.0001);
    expect(moon.magmaTemperatureK).toBe(1800);
    expect(moon.surfaceBackgroundK).toBeLessThan(200);
    expect(surfaceThermalState(14.3, 18.29, 0).effectiveK).toBeCloseTo(134.003, 1);
  });

  it('freezes the night side of a high-contrast locked lava world', () => {
    expect(globalSilicateMeltFraction(2600, 0)).toBe(1);
    const locked = globalSilicateMeltFraction(1550, 1200);
    expect(locked).toBeGreaterThan(0.25);
    expect(locked).toBeLessThan(0.75);
  });
});
