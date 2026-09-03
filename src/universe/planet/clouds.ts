import type { Rng } from '../../core/rng/rng';
import type {
  PlanetAtmosphere,
  PlanetBulk,
  PlanetClimate,
  PlanetCloudLayer,
  PlanetRotation,
} from './types';
import {
  condensationLayer,
  silicateMeltFraction,
  type AtmosphericLayer,
  type CondensationBand,
} from './thermodynamics';

const DAY_SECONDS = 86_400;

/** Thermodynamic stability intervals for the condensed materials. These are
 * material properties, not sky-color rules: a cloud can only be generated if
 * the planet's shared radiative-convective profile actually crosses one. */
const SULFURIC_ACID_BAND: CondensationBand = { coldK: 230, warmK: 430 };
const SILICATE_BAND: CondensationBand = { coldK: 1200, warmK: 2100 };
const METHANE_BAND: CondensationBand = { coldK: 70, warmK: 105 };
const CARBON_DIOXIDE_BAND: CondensationBand = { coldK: 130, warmK: 195 };
const WATER_BAND: CondensationBand = { coldK: 235, warmK: 290 };

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

function thermalLayer(
  atmosphere: PlanetAtmosphere,
  climate: PlanetClimate,
  bulk: PlanetBulk,
  band: CondensationBand,
): AtmosphericLayer | null {
  return condensationLayer(atmosphere, climate, bulk, band);
}

function layerGeometry(layer: AtmosphericLayer): Pick<PlanetCloudLayer, 'topAltitudeKm' | 'thicknessKm'> {
  return {
    topAltitudeKm: layer.topAltitudeKm,
    thicknessKm: Math.max(0.5, layer.topAltitudeKm - layer.baseAltitudeKm),
  };
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

  if (atmosphere.class === 'co2-hothouse') {
    // A CO2 greenhouse supplies sulfur chemistry, but it does not guarantee
    // acid droplets. Hotter profiles never enter the acid phase window; if
    // their surface is molten, lofted rock vapor instead condenses where its
    // own stability interval is crossed.
    const melt = silicateMeltFraction(climate.surfaceMeanK);
    const mineral = melt > 0
      ? thermalLayer(atmosphere, climate, bulk, SILICATE_BAND)
      : null;
    if (mineral) {
      const strength = melt * mineral.thermalFraction;
      return {
        condensate: 'mineral',
        coverage: Math.min(0.98, 0.18 + 0.82 * strength),
        opticalDepth: rng.range(8, 24) * Math.max(0.15, strength),
        ...layerGeometry(mineral),
        featureScaleKm: radiusKm * rng.range(0.22, 0.46),
        driftRadPerDay: drift(rng.range(45, 110), radiusKm),
        relief: rng.range(0.35, 0.7),
        stellarBias: rotation.locked ? -0.65 : 0,
        // Iron-poor silicate grains are approximately neutral scatterers in
        // visible light; the star and overlying gas supply the observed hue.
        color: [0.72, 0.72, 0.7],
      };
    }

    const acid = thermalLayer(atmosphere, climate, bulk, SULFURIC_ACID_BAND);
    if (!acid) return { ...NO_CLOUDS };
    return {
      condensate: 'sulfuric-acid',
      coverage: Math.min(1, 0.72 + 0.28 * acid.thermalFraction),
      opticalDepth: rng.range(30, 55) * Math.max(0.2, acid.thermalFraction),
      ...layerGeometry(acid),
      featureScaleKm: radiusKm * rng.range(0.38, 0.58),
      driftRadPerDay: drift(rng.range(55, 95), radiusKm),
      relief: rng.range(0.25, 0.4),
      stellarBias: 0,
      color: [0.88, 0.82, 0.65],
    };
  }

  if (atmosphere.class === 'nitrogen-methane') {
    const layer = thermalLayer(atmosphere, climate, bulk, METHANE_BAND);
    if (!layer) return { ...NO_CLOUDS };
    return {
      // The orange global layer is tholin aerosol and is already in the
      // atmospheric column. Actual methane clouds are bright and sparse.
      condensate: 'methane',
      coverage: rng.range(0.035, 0.14),
      opticalDepth: rng.range(4, 12),
      ...layerGeometry(layer),
      featureScaleKm: radiusKm * rng.range(0.1, 0.22),
      driftRadPerDay: drift(rng.range(5, 22), radiusKm),
      relief: rng.range(0.55, 0.85),
      stellarBias: 0,
      color: [0.88, 0.9, 0.88],
    };
  }

  if (atmosphere.class === 'rock-vapor') {
    const layer = thermalLayer(atmosphere, climate, bulk, SILICATE_BAND);
    if (!layer) return { ...NO_CLOUDS };
    return {
      condensate: 'mineral',
      coverage: rng.range(0.06, 0.18),
      opticalDepth: rng.range(2, 7),
      ...layerGeometry(layer),
      featureScaleKm: radiusKm * rng.range(0.12, 0.25),
      driftRadPerDay: drift(rng.range(30, 90), radiusKm),
      relief: rng.range(0.35, 0.65),
      // Tidally locked vapor condenses after it crosses onto the cold side.
      stellarBias: rotation.locked ? -0.85 : 0,
      color: [0.72, 0.72, 0.7],
    };
  }

  if (atmosphere.class === 'thin-co2') {
    const cold = climate.surfaceMeanK < 225;
    const layer = thermalLayer(
      atmosphere,
      climate,
      bulk,
      cold ? CARBON_DIOXIDE_BAND : WATER_BAND,
    );
    if (!layer) return { ...NO_CLOUDS };
    return {
      condensate: cold ? 'carbon-dioxide' : 'water',
      coverage: cold ? rng.range(0.05, 0.18) : rng.range(0.015, 0.07),
      opticalDepth: cold ? rng.range(2, 6) : rng.range(1, 4),
      ...layerGeometry(layer),
      featureScaleKm: radiusKm * rng.range(0.15, 0.32),
      driftRadPerDay: drift(rng.range(12, 35), radiusKm),
      relief: cold ? rng.range(0.2, 0.45) : rng.range(0.45, 0.7),
      stellarBias: 0,
      color: cold ? [0.82, 0.87, 0.92] : [0.9, 0.91, 0.92],
    };
  }

  const wet = climate.hydrosphere === 'oceans';
  const frozen = climate.hydrosphere === 'ice-sheet';
  const layer = thermalLayer(atmosphere, climate, bulk, WATER_BAND);
  if (!layer) return { ...NO_CLOUDS };
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
    ...layerGeometry(layer),
    featureScaleKm,
    driftRadPerDay: drift(windMs, radiusKm),
    relief: 0.25 + 0.7 * convection,
    // Ocean-bearing locked worlds build a persistent dayside convective cap.
    stellarBias: rotation.locked && wet ? 0.65 : 0,
    color: [0.92, 0.93, 0.95],
  };
}
