import { describe, expect, it } from 'vitest';
import { K_B } from '../../core/physics/constants';
import { Rng } from '../../core/rng/rng';
import { generateSystem } from '../system/generate';
import { atmosphereAtTemperature, finalizeAtmosphere, withThermostatCo2 } from './atmosphere';
import { computeClimate } from './climate';
import { isStellarSynchronous, solarDayHours } from './rotation';
import type { PlanetAtmosphere, PlanetBulk, PlanetRotation } from './types';

const BULK: PlanetBulk = { massEarth: 1, radiusEarth: 1, densityGcc: 5.51, gravityMs2: 9.81, escapeVelocityKms: 11.2, oblateness: 0 };
const NITROGEN: PlanetAtmosphere = { class: 'nitrogen', surfacePressureBar: 0.5, opticalDepth: 0.5, scaleHeightKm: 8, scatteringColor: [0.35, 0.55, 1] };

describe('shared final atmospheric state', () => {
  it('adds a CO2-majority reservoir once and updates its bulk properties', () => {
    const air = withThermostatCo2(NITROGEN, 1.25, 300, BULK);
    expect(air.surfacePressureBar).toBeCloseTo(1.75);
    expect(air.class).toBe('co2-hothouse');
    expect(air.meanMolecularMassAmu).toBeCloseTo((0.5 * 28 + 1.25 * 44) / 1.75);
    expect(air.aerosolClass).toBe('nitrogen');
    expect(air.specificHeatJkgK).toBeLessThan(1040);
    expect(withThermostatCo2(air, 1.25, 300, BULK)).toEqual(air);
    expect(withThermostatCo2(air, 0, 300, BULK).surfacePressureBar).toBeCloseTo(0.5);
    expect(withThermostatCo2(air, 0, 300, BULK).class).toBe('nitrogen');
  });

  it('treats preexisting and thermostat CO2 as the same absorbing species', () => {
    const initial: PlanetAtmosphere = { ...NITROGEN, class: 'thin-co2', surfacePressureBar: 0.2, opticalDepth: 5.8 * 0.2 ** 0.7 };
    expect(withThermostatCo2(initial, 0.8, 300, BULK).opticalDepth).toBeCloseTo(5.8);
  });

  it('finalizes planet and moon columns consistently through the same path', () => {
    const rotation: PlanetRotation = { periodHours: 24, obliquityRad: 0, locked: false, spinOrbitResonance: null };
    const climate = computeClimate(new Rng(21n), 'rocky', NITROGEN, BULK,
      { ironCoreFraction: 0.33, heatFluxWm2: 0.09, regime: 'active-tectonics', magneticFieldRelEarth: 1 },
      rotation, [1, 1, 1], 1, 1.4, 4.6);
    expect(climate.co2Bar).toBeGreaterThan(0);
    const air = finalizeAtmosphere(NITROGEN, climate, BULK);
    expect(air.surfacePressureBar).toBeCloseTo(0.5 + climate.co2Bar + air.waterReservoir!.vaporKgM2! * BULK.gravityMs2 / 1e5, 12);
    let repeated = air;
    for (let i = 0; i < 10; i++) repeated = finalizeAtmosphere(repeated, climate, BULK);
    for (const key of ['surfacePressureBar', 'meanMolecularMassAmu', 'opticalDepth', 'specificHeatJkgK', 'scaleHeightKm'] as const) {
      expect(repeated[key]).toBeCloseTo(air[key]!, 11);
    }
    for (const gas of Object.keys(air.partialPressuresBar!) as Array<keyof typeof air.partialPressuresBar>) {
      expect(repeated.partialPressuresBar![gas]).toBeCloseTo(air.partialPressuresBar![gas]!, 12);
    }
  });

  it('all generated planets and moons expose a normalized inventory and final-temperature scale height', () => {
    for (let i = 0; i < 100; i++) {
      const s = generateSystem(BigInt(700000 + i));
      for (const p of [...s.planets, ...s.companions.flatMap(c => c.planets)]) for (const body of [p.physical, ...p.moons.map(m => m.physical)]) {
        const air = body.atmosphere;
        const total = Object.values(air.partialPressuresBar ?? {}).reduce((sum, p) => sum + p, 0);
        expect(total).toBeCloseTo(air.surfacePressureBar, 8);
        expect(air.thermostatCo2Bar).toBe(body.climate.co2Bar);
        if (total <= 0) continue;
        const expectedH = K_B * body.climate.surfaceMeanK / (air.meanMolecularMassAmu! * 1.66054e-27 * body.bulk.gravityMs2) / 1000;
        expect(air.scaleHeightKm / expectedH).toBeCloseTo(1, 12);
        expect(atmosphereAtTemperature(air, body.climate.surfaceMeanK, body.bulk)).toEqual(air);
      }
    }
  });
});

describe('stellar versus satellite synchronization', () => {
  it('a planet-locked moon still has a solar day and no permanent stellar heating contrast', () => {
    const moon: PlanetRotation = { periodHours: 27.3 * 24, obliquityRad: 0, locked: true, lockTarget: 'planet', spinOrbitResonance: null };
    expect(isStellarSynchronous(moon)).toBe(false);
    expect(solarDayHours(moon, 365.25 * 24)! / 24).toBeCloseTo(29.5, 1);
    expect(solarDayHours({ ...moon, periodHours: 365.25 * 24, lockTarget: 'star' }, 365.25 * 24)).toBeNull();
    const s = generateSystem(0xdd3997bb22cbd39bn);
    for (const p of s.planets) for (const m of p.moons) {
      expect(m.physical.climate.dayNightDeltaK).toBe(0);
      expect(m.physical.appearance.clouds.stellarBias).toBe(0);
      expect(m.physical.rotation.solarDayHours).toBeGreaterThan(0);
    }
  });
});
