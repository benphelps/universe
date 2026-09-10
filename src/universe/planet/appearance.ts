import { deriveGiantAtmosphere, type GiantAtmosphereState } from './giantAtmosphere';
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
    const state = deriveGiantAtmosphere(climate, interior, atmosphere, bulk, rotation);
    return {
      landColorA: [0, 0, 0],
      landColorB: [0, 0, 0],
      oceanColor: [0, 0, 0],
      iceColor: [0, 0, 0],
      clouds: { ...NO_CLOUDS },
      lavaGlow: 0,
      banding: computeBanding(rng, planetClass, state, rotation),
    };
  }

  let landColorA: Rgb;
  let landColorB: Rgb;
  let lavaGlow = 0;

  const molten = climate.hydrosphere === 'magma';
  if (molten) {
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
    oceanColor: molten ? [0.05, 0.04, 0.038] : [0.02, 0.09, 0.18],
    iceColor: [0.82, 0.86, 0.9],
    clouds: computeCloudLayer(rng.fork('clouds'), atmosphere, climate, bulk, rotation),
    lavaGlow,
    banding: null,
  };
}

/** Lightweight catalogue summary. The renderer derives individual jet edges
 * from the same cloud state; these counts describe the expected regime. */
function computeBanding(
  rng: Rng,
  planetClass: PlanetClass,
  atmosphere: GiantAtmosphereState,
  rotation: PlanetRotation,
): GiantBanding {
  const rotationFactor = Math.sqrt(24 / Math.max(rotation.periodHours, 4));
  const cold = Math.max(0, Math.min(1, (98 - atmosphere.temperatureK) / 23));
  const hot = Math.max(0, Math.min(1, (atmosphere.temperatureK - 750) / 350));
  const baseCount = (planetClass === 'gas-giant' ? 7 : 4) + 4 * rotationFactor;
  const bandCount = Math.round(baseCount * (1 - .4 * cold - .25 * hot));
  return {
    atmosphere, bandCount,
    zoneColor: atmosphere.palette.zone,
    beltColor: atmosphere.palette.belt,
    stormColor: atmosphere.palette.stormAged,
    turbulence: rng.range(.4, .8) * (1 - .75 * cold),
    majorStormSize: !rotation.locked && rng.bool(.4) ? rng.range(.04, .12) : 0,
    thermalGlowK: atmosphere.temperatureK > 700 ? atmosphere.temperatureK : 0,
  };
}
