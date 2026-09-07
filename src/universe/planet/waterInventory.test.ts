import { describe, expect, it } from 'vitest';
import { Rng } from '../../core/rng/rng';
import { atmosphereAtTemperature, withWaterVapor } from './atmosphere';
import { partitionWater } from './waterInventory';
import { waterSaturationPa } from './waterPhase';
import { atmosphericColumnProfile, waterCondensationLayer } from './thermodynamics';
import { columnStateAt } from './hydrostaticColumn';
import { computeCloudLayer } from './clouds';
import type { PlanetAtmosphere, PlanetBulk, PlanetClimate, PlanetRotation } from './types';

const bulk: PlanetBulk = { massEarth: 1, radiusEarth: 1, gravityMs2: 9.81, densityGcc: 5.5, escapeVelocityKms: 11.2, oblateness: 0 };
const air: PlanetAtmosphere = { class: 'nitrogen', surfacePressureBar: 1, scaleHeightKm: 8, opticalDepth: 1, scatteringColor: [1,1,1], partialPressuresBar: { N2: 0.8, CO2: 0.2 } };
const climate = { surfaceMeanK: 288, equilibriumK: 255, waterMassFraction: 4e-4, hydrosphere: 'oceans', oceanCoverage: 0.7 } as PlanetClimate;
const spin = { periodHours: 24, obliquityRad: 0, locked: false, spinOrbitResonance: null } as PlanetRotation;

describe('finite reference water reservoir', () => {
  it('closes gas plus condensate and reaches prescribed humidity or exhausts supply', () => {
    for (const total of [0, 1e-5, 1, 1000, 1e7]) {
      const w = partitionWater(total, 1e5, 28, 9.81, 288);
      expect(w.vaporKgM2! + w.condensedKgM2!).toBeCloseTo(total, 9);
      expect(w.partialPa).toBeLessThanOrEqual(waterSaturationPa(288)! * 0.60000001);
      expect(w.vaporKgM2!).toBeLessThanOrEqual(total);
      if (w.condensedKgM2! > 0) expect(w.relativeHumidity).toBeCloseTo(0.6, 12);
    }
    expect(partitionWater(1e7, 100, 28, 9.81, 350).status).toBe('steam-limit');
    expect(partitionWater(1e7, 1e5, 28, 9.81, 700).status).toBe('temperature-limit');
  });
  it('preserves every dry species mass, total supporting pressure and gray opacity', () => {
    const dry = atmosphereAtTemperature(air, 288, bulk), wet = withWaterVapor(dry, 4e-4, 288, bulk);
    const addedWeightBar = wet.waterReservoir!.vaporKgM2! * bulk.gravityMs2 / 1e5;
    expect(wet.surfacePressureBar).toBeCloseTo(dry.surfacePressureBar + addedWeightBar, 12);
    for (const [gas, mass] of [['N2', 28], ['CO2', 44]] as const) {
      const before = dry.partialPressuresBar![gas]! * mass / dry.meanMolecularMassAmu!;
      const after = wet.partialPressuresBar![gas]! * mass / wet.meanMolecularMassAmu!;
      expect(after).toBeCloseTo(before, 12);
    }
    expect(wet.opticalDepth).toBe(dry.opticalDepth);
    const repeated = withWaterVapor(wet, 4e-4, 288, bulk);
    expect(repeated.surfacePressureBar).toBeCloseTo(wet.surfacePressureBar, 12);
    expect(withWaterVapor(wet, 0, 288, bulk).surfacePressureBar).toBeCloseTo(dry.surfacePressureBar, 12);
  });
  it('requires real vapor and condensate supply and locates the saturation crossing', () => {
    const wet = withWaterVapor(air, 4e-4, 288, bulk);
    const layer = waterCondensationLayer(wet, climate, bulk)!;
    expect(layer.baseAltitudeKm).toBeGreaterThan(0.3);
    expect(layer.topAltitudeKm).toBeGreaterThan(layer.baseAltitudeKm);
    const c = atmosphericColumnProfile(wet, climate, bulk)!;
    const base = columnStateAt(c, layer.baseAltitudeKm * 1000);
    expect(base.pressurePa * wet.partialPressuresBar!.H2O! / wet.surfacePressureBar / waterSaturationPa(base.temperatureK)!).toBeCloseTo(1, 3);
    expect(layer.topAltitudeKm * 1000).toBeLessThanOrEqual((c.surfaceTemperatureK - c.capTemperatureK) / c.lapseKPerM + 0.1);
    expect(waterCondensationLayer(withWaterVapor(air, 0, 288, bulk), climate, bulk)).toBeNull();
    const clouds = computeCloudLayer(new Rng(10n), wet, climate, bulk, spin);
    expect(clouds.condensate).toBe('water');
    expect(clouds.condensateColumnKgM2!).toBeLessThanOrEqual(wet.waterReservoir!.condensedKgM2!);
    expect(clouds.condensateColumnKgM2!).toBeLessThanOrEqual(wet.waterReservoir!.vaporKgM2!);
    expect(computeCloudLayer(new Rng(10n), air, { ...climate, waterMassFraction: 0 }, bulk, spin).condensate).toBe('none');
  });
});
