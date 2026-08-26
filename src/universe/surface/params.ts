import { EARTH_RADIUS } from '../../core/physics/constants';
import type { Characterization } from '../planet/types';

export type TectonicStyle = 'active' | 'stagnant' | 'dead';

type Rgb = [number, number, number];

/**
 * Numeric recipe for a world's terrain, derived once from its physics.
 * Every knob traces back to the characterization: gravity sets relief,
 * atmosphere sets erosion, age and geology set crater retention, climate
 * sets snow and biome behavior.
 */
export interface SurfaceParams {
  seedHex: string;
  radiusM: number;
  /** Peak-to-trough continental relief, meters. */
  reliefM: number;
  oceanCoverage: number;
  tectonics: TectonicStyle;
  /** 0 = crater-free, 1 = saturated airless highlands. */
  craterAmplitude: number;
  /** 0 = crisp airless terrain, 1 = heavily smoothed/wet. */
  erosion: number;
  volcanism: number;
  /** Mean surface temperature and pole-equator drop for snow/biome lines. */
  surfaceMeanK: number;
  poleDeltaK: number;
  /** Altitude lapse rate, K per km. */
  lapseKPerKm: number;
  /** Sets the circulation regime: fast rotators band, slow ones don't. */
  rotationPeriodHours: number;
  biosphere: boolean;
  globalIce: boolean;
  palette: {
    landA: Rgb;
    landB: Rgb;
    rock: Rgb;
    ice: Rgb;
    seabed: Rgb;
  };
}

export function deriveSurfaceParams(seedHex: string, physical: Characterization): SurfaceParams {
  const { bulk, interior, atmosphere, climate, appearance } = physical;
  const gravityRatio = 9.81 / Math.max(bulk.gravityMs2, 0.5);

  const erosion =
    climate.hydrosphere === 'oceans'
      ? 0.8
      : atmosphere.surfacePressureBar > 0.05
        ? 0.45 + 0.2 * Math.min(1, atmosphere.surfacePressureBar)
        : 0.05;

  const tectonics: TectonicStyle =
    interior.regime === 'active-tectonics'
      ? 'active'
      : interior.regime === 'stagnant-lid' || interior.regime === 'magma'
        ? 'stagnant'
        : 'dead';

  const craterRetention = tectonics === 'dead' ? 1 : tectonics === 'stagnant' ? 0.35 : 0.05;

  const radiusM = bulk.radiusEarth * EARTH_RADIUS;
  return {
    seedHex,
    radiusM,
    // Crust strength sets relief against gravity, but never more than a
    // few percent of the body: beyond that it's shape, not terrain
    // (Moon 0.5% R, Mars 0.9% R, Vesta ~8% R at the small-body limit).
    reliefM: Math.min(26000, radiusM * 0.08, Math.max(900, 5500 * gravityRatio ** 0.7)),
    oceanCoverage: climate.hydrosphere === 'oceans' ? climate.oceanCoverage : 0,
    tectonics,
    craterAmplitude: craterRetention * (1 - erosion * 0.85),
    erosion,
    volcanism:
      interior.regime === 'magma'
        ? 1
        : interior.regime === 'stagnant-lid'
          ? 0.5
          : interior.regime === 'active-tectonics'
            ? 0.25
            : 0,
    surfaceMeanK: climate.surfaceMeanK,
    poleDeltaK: 30,
    lapseKPerKm: atmosphere.class === 'none' ? 0 : 5.5,
    rotationPeriodHours: physical.rotation.periodHours,
    biosphere: climate.biosphere,
    globalIce: climate.hydrosphere === 'ice-sheet',
    palette: {
      landA: appearance.landColorA,
      landB: appearance.landColorB,
      rock: [0.3, 0.27, 0.24],
      ice: appearance.iceColor,
      seabed: [
        appearance.oceanColor[0] * 0.6 + 0.05,
        appearance.oceanColor[1] * 0.6 + 0.05,
        appearance.oceanColor[2] * 0.6 + 0.04,
      ],
    },
  };
}
