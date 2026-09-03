import type { Rng } from '../../core/rng/rng';
import type {
  PlanetAtmosphere,
  PlanetBulk,
  PlanetClimate,
  PlanetCloudLayer,
  PlanetRotation,
} from './types';

const DAY_SECONDS = 86_400;

export const NO_CLOUDS: PlanetCloudLayer = {
  condensate: 'none',
  coverage: 0,
  opticalDepth: 0,
  topAltitudeKm: 0,
  thicknessKm: 0,
  featureScaleKm: 1,
  driftRadPerDay: 0,
  relief: 0,
  stellarBias: 0,
  color: [0, 0, 0],
};

function drift(windMs: number, radiusKm: number): number {
  return (windMs * DAY_SECONDS) / Math.max(radiusKm * 1000, 1);
}

/** A rotation-scaled synoptic length. Slow rotators organize weather
 *  into broader cells; rapid rotators break it into narrower systems. */
function synopticScale(radiusKm: number, periodHours: number): number {
  const rotationScale = Math.sqrt(Math.min(16, Math.max(0.2, periodHours / 24)));
  return Math.min(radiusKm * 0.8, Math.max(180, radiusKm * 0.22 * rotationScale));
}

/**
 * Condensate clouds derived separately from atmospheric aerosol. The
 * present climate model is global, so this is still a statistical deck,
 * but its material, height, opacity and circulation scale are explicit
 * rather than hidden in a color and one coverage number.
 */
export function computeCloudLayer(
  rng: Rng,
  atmosphere: PlanetAtmosphere,
  climate: PlanetClimate,
  bulk: PlanetBulk,
  rotation: PlanetRotation,
): PlanetCloudLayer {
  if (atmosphere.class === 'none' || atmosphere.class === 'hydrogen-helium') {
    return { ...NO_CLOUDS };
  }

  const radiusKm = bulk.radiusEarth * 6371;
  const scaleHeightKm = Math.max(atmosphere.scaleHeightKm, 0.1);

  if (atmosphere.class === 'co2-hothouse') {
    return {
      condensate: 'sulfuric-acid',
      coverage: 1,
      opticalDepth: rng.range(30, 55),
      // Venus's visible cloud tops stand tens of kilometres above the
      // surface, not at the generic one-scale-height height used before.
      topAltitudeKm: Math.max(45, 10 * scaleHeightKm),
      thicknessKm: Math.max(18, 3.5 * scaleHeightKm),
      featureScaleKm: radiusKm * rng.range(0.38, 0.58),
      driftRadPerDay: drift(rng.range(55, 95), radiusKm),
      relief: rng.range(0.25, 0.4),
      stellarBias: 0,
      color: [0.88, 0.82, 0.65],
    };
  }

  if (atmosphere.class === 'nitrogen-methane') {
    return {
      // The orange global layer is tholin aerosol and is already in the
      // atmospheric column. Actual methane clouds are bright and sparse.
      condensate: 'methane',
      coverage: rng.range(0.035, 0.14),
      opticalDepth: rng.range(4, 12),
      topAltitudeKm: Math.max(15, 0.9 * scaleHeightKm),
      thicknessKm: Math.max(3, 0.25 * scaleHeightKm),
      featureScaleKm: radiusKm * rng.range(0.1, 0.22),
      driftRadPerDay: drift(rng.range(5, 22), radiusKm),
      relief: rng.range(0.55, 0.85),
      stellarBias: 0,
      color: [0.88, 0.9, 0.88],
    };
  }

  if (atmosphere.class === 'rock-vapor') {
    return {
      condensate: 'mineral',
      coverage: rng.range(0.06, 0.18),
      opticalDepth: rng.range(2, 7),
      topAltitudeKm: Math.max(8, 1.6 * scaleHeightKm),
      thicknessKm: Math.max(2, 0.35 * scaleHeightKm),
      featureScaleKm: radiusKm * rng.range(0.12, 0.25),
      driftRadPerDay: drift(rng.range(30, 90), radiusKm),
      relief: rng.range(0.35, 0.65),
      // Tidally locked vapor condenses after it crosses onto the cold side.
      stellarBias: rotation.locked ? -0.85 : 0,
      color: [0.72, 0.67, 0.62],
    };
  }

  if (atmosphere.class === 'thin-co2') {
    const cold = climate.surfaceMeanK < 225;
    return {
      condensate: cold ? 'carbon-dioxide' : 'water',
      coverage: cold ? rng.range(0.05, 0.18) : rng.range(0.015, 0.07),
      opticalDepth: cold ? rng.range(2, 6) : rng.range(1, 4),
      topAltitudeKm: Math.max(8, 1.8 * scaleHeightKm),
      thicknessKm: Math.max(2, 0.35 * scaleHeightKm),
      featureScaleKm: radiusKm * rng.range(0.15, 0.32),
      driftRadPerDay: drift(rng.range(12, 35), radiusKm),
      relief: cold ? rng.range(0.2, 0.45) : rng.range(0.45, 0.7),
      stellarBias: 0,
      color: cold ? [0.82, 0.87, 0.92] : [0.9, 0.91, 0.92],
    };
  }

  const wet = climate.hydrosphere === 'oceans';
  const frozen = climate.hydrosphere === 'ice-sheet';
  const coverage = wet
    ? rng.range(0.42, 0.68)
    : frozen
      ? rng.range(0.12, 0.32)
      : rng.range(0.02, 0.1);
  const convection = wet
    ? Math.min(1, Math.max(0.25, (climate.surfaceMeanK - 255) / 45))
    : frozen
      ? 0.22
      : 0.4;
  const featureScaleKm = synopticScale(radiusKm, rotation.periodHours);
  const windMs = rng.range(10, 28) * (rotation.locked ? 1.8 : 1);
  return {
    condensate: 'water',
    coverage,
    opticalDepth: wet ? rng.range(8, 24) : rng.range(2, 9),
    topAltitudeKm: Math.max(6, (0.8 + 0.65 * convection) * scaleHeightKm),
    thicknessKm: Math.max(2, (0.22 + 0.35 * convection) * scaleHeightKm),
    featureScaleKm,
    driftRadPerDay: drift(windMs, radiusKm),
    relief: 0.25 + 0.7 * convection,
    // Ocean-bearing locked worlds build a persistent dayside convective cap.
    stellarBias: rotation.locked && wet ? 0.65 : 0,
    color: [0.92, 0.93, 0.95],
  };
}
