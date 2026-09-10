import { EARTH_RADIUS, SIGMA_SB } from '../../core/physics/constants';
import type { PlanetAtmosphere, PlanetBulk, PlanetClimate, PlanetInterior, PlanetRotation } from './types';

export type GiantRgb = [number, number, number];
export interface GiantCloudPalette {
  zone: GiantRgb;
  belt: GiantRgb;
  stormFresh: GiantRgb;
  stormAged: GiantRgb;
  hood: GiantRgb;
}
export interface GiantAtmosphereState {
  temperatureK: number;
  palette: GiantCloudPalette;
  /** Effective pressures of two visible condensate layers; reduced column model. */
  deckPressureBar: number;
  upperPressureBar: number;
  upperAltitudeKm: number;
  upperOpticalDepth: number;
  reliefKm: number;
  /** Mean and dipole amplitude of T^4. Their spherical mean is the energy budget. */
  meanTemperature4: number;
  temperatureDipole4: number;
  hotspotOffsetRad: number;
  windMs: number;
  windRadPerDay: number;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
const methane: GiantCloudPalette = {
  zone: [.4, .63, .76], belt: [.3, .53, .7], stormFresh: [.88, .92, .96],
  stormAged: [.16, .28, .45], hood: [.34, .55, .68],
};
const ammonia: GiantCloudPalette = {
  zone: [.8, .73, .6], belt: [.52, .38, .25], stormFresh: [.92, .9, .85],
  stormAged: [.75, .4, .26], hood: [.55, .5, .42],
};
const water: GiantCloudPalette = {
  zone: [.75, .78, .83], belt: [.56, .61, .68], stormFresh: [.92, .92, .94],
  stormAged: [.72, .66, .6], hood: [.6, .64, .7],
};
const hot: GiantCloudPalette = {
  zone: [.14, .11, .09], belt: [.24, .16, .11], stormFresh: [.36, .28, .2],
  stormAged: [.3, .19, .12], hood: [.1, .08, .07],
};
function blend(a: GiantCloudPalette, b: GiantCloudPalette, t: number): GiantCloudPalette {
  const rgb = (key: keyof GiantCloudPalette): GiantRgb => a[key].map((v, i) => v + (b[key][i] - v) * t) as GiantRgb;
  return { zone: rgb('zone'), belt: rgb('belt'), stormFresh: rgb('stormFresh'), stormAged: rgb('stormAged'), hood: rgb('hood') };
}

/** Shared reduced cloud column. Condensate families interpolate with effective
 * temperature (including intrinsic heat), rather than switching on irradiation
 * alone. Pressure levels and RGB palettes are approximations, not chemistry retrievals. */
export function giantCloudPalette(temperatureK: number): GiantCloudPalette {
  return blend(blend(blend(methane, ammonia, smooth(75, 98, temperatureK)), water,
    smooth(220, 300, temperatureK)), hot, smooth(750, 1100, temperatureK));
}

export function deriveGiantAtmosphere(
  climate: PlanetClimate,
  interior: PlanetInterior,
  atmosphere: PlanetAtmosphere,
  bulk: PlanetBulk,
  rotation: PlanetRotation,
): GiantAtmosphereState {
  const temperatureK = climate.effectiveK ?? climate.surfaceMeanK;
  const meanTemperature4 = temperatureK ** 4;
  const locked = rotation.locked && rotation.lockTarget !== 'planet';
  // Radiative relaxation at a representative 0.2-bar photosphere and zonal
  // advection: the steady first harmonic of tau*dE/dt + E = forcing.
  const windMs = Math.min(3000, 900 * Math.sqrt(Math.max(temperatureK, 1) / 1000));
  const radiativeSeconds = (atmosphere.specificHeatJkgK ?? 13000) * 20000
    / (Math.max(bulk.gravityMs2, .1) * 4 * SIGMA_SB * Math.max(temperatureK, 30) ** 3);
  const advectiveSeconds = bulk.radiusEarth * EARTH_RADIUS / windMs;
  const transport = radiativeSeconds / Math.max(advectiveSeconds, 1);
  const stellarTemperature4 = Math.min(meanTemperature4, climate.equilibriumK ** 4);
  const temperatureDipole4 = locked ? .95 * stellarTemperature4 / Math.hypot(1, transport) : 0;
  const activity = Math.min(1, Math.cbrt(Math.max(interior.heatFluxWm2, 0) / 5.4));
  const deckPressureBar = .7 + 1.3 * smooth(180, 300, temperatureK);
  const upperPressureBar = deckPressureBar * (.22 + .18 * activity);
  const upperAltitudeKm = atmosphere.scaleHeightKm * Math.log(deckPressureBar / upperPressureBar);
  return {
    temperatureK, palette: giantCloudPalette(temperatureK), deckPressureBar, upperPressureBar,
    upperAltitudeKm,
    // Peak optical depth of the thin upper condensate patches. Weak mixing
    // retains more condensate, while the optically thick weather stays in the deck.
    upperOpticalDepth: (.08 + .20 * (1 - activity)) * (1 - .7 * smooth(700, 1200, temperatureK)),
    reliefKm: atmosphere.scaleHeightKm * (.3 + .7 * activity),
    meanTemperature4, temperatureDipole4,
    hotspotOffsetRad: locked ? Math.atan(transport) : 0,
    windMs,
    windRadPerDay: windMs * 86400 / (bulk.radiusEarth * EARTH_RADIUS),
  };
}

/** Longitude convention for a shader point: dot(direction, displaced hotspot). */
export function giantTemperatureK(state: GiantAtmosphereState, hotspotCosine: number): number {
  return Math.max(0, state.meanTemperature4 + state.temperatureDipole4 * Math.max(-1, Math.min(1, hotspotCosine))) ** .25;
}
