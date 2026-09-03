import type { Rng } from '../../core/rng/rng';
import type { PlanetClass } from '../system/types';
import type {
  GiantBanding,
  PlanetAppearance,
  PlanetAtmosphere,
  PlanetBulk,
  PlanetClimate,
  PlanetInterior,
  PlanetRotation,
} from './types';
import { computeCloudLayer, NO_CLOUDS } from './clouds';

type Rgb = [number, number, number];

/**
 * Visual parameters derived from the physics — mineralogy and oxidation
 * pick land palettes, temperature picks giant chromophores, climate
 * picks clouds and ice. Nothing here is drawn from an art table.
 */
export function computeAppearance(
  rng: Rng,
  planetClass: PlanetClass,
  bulk: PlanetBulk,
  atmosphere: PlanetAtmosphere,
  climate: PlanetClimate,
  interior: PlanetInterior,
  rotation: PlanetRotation,
  ageGyr: number,
): PlanetAppearance {
  const envelope = atmosphere.class === 'hydrogen-helium';
  if (envelope) {
    return {
      landColorA: [0, 0, 0],
      landColorB: [0, 0, 0],
      oceanColor: [0, 0, 0],
      iceColor: [0, 0, 0],
      clouds: { ...NO_CLOUDS },
      lavaGlow: 0,
      banding: computeBanding(rng, planetClass, climate.equilibriumK, rotation),
    };
  }

  let landColorA: Rgb;
  let landColorB: Rgb;
  let lavaGlow = 0;

  if (interior.regime === 'magma') {
    landColorA = [0.09, 0.08, 0.08];
    landColorB = [0.16, 0.13, 0.11];
    lavaGlow = 1;
  } else if (atmosphere.class === 'thin-co2' && interior.regime === 'dead' && ageGyr > 2) {
    // Iron-oxide weathering on old, dry, geologically quiet worlds.
    landColorA = [0.44, 0.25, 0.14];
    landColorB = [0.58, 0.36, 0.2];
  } else if (climate.hydrosphere === 'oceans' && climate.biosphere) {
    // Vegetation-like ground cover alongside bare rock.
    landColorA = [0.12, 0.28, 0.1];
    landColorB = [0.45, 0.4, 0.28];
  } else if (climate.surfaceMeanK > 350) {
    landColorA = [0.5, 0.42, 0.3];
    landColorB = [0.62, 0.52, 0.36];
  } else {
    landColorA = [0.3, 0.27, 0.23];
    landColorB = [0.44, 0.39, 0.31];
  }

  return {
    landColorA,
    landColorB,
    // Molten worlds' "seas" are melt under a chilling crust — their
    // reflectance is basalt-dark; the light they show is their own.
    oceanColor: interior.regime === 'magma' ? [0.05, 0.04, 0.038] : [0.02, 0.09, 0.18],
    iceColor: [0.82, 0.86, 0.9],
    clouds: computeCloudLayer(rng.fork('clouds'), atmosphere, climate, bulk, rotation),
    lavaGlow,
    banding: null,
  };
}

function computeBanding(
  rng: Rng,
  planetClass: PlanetClass,
  equilibriumK: number,
  rotation: PlanetRotation,
): GiantBanding {
  // Faster rotators shear their clouds into more, narrower bands.
  const rotationFactor = Math.sqrt(24 / Math.max(rotation.periodHours, 4));
  const smallEnvelope = planetClass !== 'gas-giant';

  if (equilibriumK > 900) {
    return {
      bandCount: Math.round(3 + 3 * rotationFactor),
      zoneColor: [0.13, 0.1, 0.09],
      beltColor: [0.22, 0.15, 0.11],
      stormColor: [0.3, 0.2, 0.13],
      turbulence: rng.range(0.5, 0.9),
      majorStormSize: 0,
      thermalGlowK: equilibriumK,
    };
  }
  if (equilibriumK < 90) {
    // Methane absorption removes red: teal-to-azure, nearly featureless.
    return {
      bandCount: Math.round(2 + 2 * rotationFactor),
      zoneColor: [0.38, 0.62, 0.75],
      beltColor: [0.28, 0.52, 0.7],
      stormColor: [0.85, 0.9, 0.95],
      turbulence: rng.range(0.05, 0.25),
      majorStormSize: rng.bool(0.25) ? rng.range(0.03, 0.07) : 0,
      thermalGlowK: 0,
    };
  }
  if (equilibriumK < 250) {
    // Ammonia-cloud chromophores: cream zones, tan-brown belts.
    return {
      bandCount: Math.round((smallEnvelope ? 4 : 7) + 4 * rotationFactor),
      zoneColor: [0.8, 0.73, 0.6],
      beltColor: [0.52, 0.38, 0.25],
      stormColor: [0.78, 0.45, 0.3],
      turbulence: rng.range(0.4, 0.8),
      majorStormSize: rng.bool(0.4) ? rng.range(0.06, 0.12) : 0,
      thermalGlowK: 0,
    };
  }
  // Water-cloud regime: bright, low-contrast blue-white decks.
  return {
    bandCount: Math.round(5 + 3 * rotationFactor),
    zoneColor: [0.75, 0.78, 0.83],
    beltColor: [0.55, 0.6, 0.68],
    stormColor: [0.9, 0.9, 0.92],
    turbulence: rng.range(0.3, 0.6),
    majorStormSize: rng.bool(0.2) ? rng.range(0.04, 0.08) : 0,
    thermalGlowK: 0,
  };
}
