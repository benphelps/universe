import type { AtmosphereClass, PlanetAtmosphere, PlanetBulk, PlanetClimate } from './types';

/** Silicate rock begins to melt across a composition-dependent interval.
 * These bounds bracket common basaltic/peridotitic solidus and liquidus
 * temperatures; the melt fraction is interpolated between them rather than
 * assigning a visual state from orbital distance or planet class. */
export const SILICATE_SOLIDUS_K = 1300;
export const SILICATE_LIQUIDUS_K = 1800;

/** Representative constant-pressure heat capacities for each bulk gas.
 * They turn gravity into a dry-adiabatic lapse rate, g/cp. The atmosphere
 * taxonomy supplies composition only; it no longer directly chooses a cloud. */
const SPECIFIC_HEAT_J_KG_K: Record<AtmosphereClass, number> = {
  none: 1000,
  'hydrogen-helium': 14_300,
  nitrogen: 1040,
  'nitrogen-oxygen': 1005,
  'co2-hothouse': 1000,
  'thin-co2': 850,
  'nitrogen-methane': 1100,
  'rock-vapor': 1000,
};

/** The gray-atmosphere skin temperature: the cold radiative ceiling to which
 * a convective profile can fall before becoming approximately isothermal. */
export function skinTemperatureK(equilibriumK: number): number {
  return equilibriumK / 2 ** 0.25;
}

/** Dry-adiabatic temperature fall in kelvin per kilometre. */
export function dryLapseRateKPerKm(
  atmosphere: PlanetAtmosphere,
  bulk: PlanetBulk,
): number {
  if (atmosphere.class === 'none') return 0;
  return (bulk.gravityMs2 * 1000) / SPECIFIC_HEAT_J_KG_K[atmosphere.class];
}

/** A compact radiative-convective profile: adiabatic below the radiative
 * ceiling and isothermal above it. This is deliberately shared by every
 * condensate so cloud height follows T(z), not a class-specific scale-height
 * multiplier. */
export function atmosphericTemperatureK(
  atmosphere: PlanetAtmosphere,
  climate: PlanetClimate,
  bulk: PlanetBulk,
  altitudeKm: number,
): number {
  const lapse = dryLapseRateKPerKm(atmosphere, bulk);
  return Math.max(
    skinTemperatureK(climate.equilibriumK),
    climate.surfaceMeanK - lapse * Math.max(altitudeKm, 0),
  );
}

export interface CondensationBand {
  /** Warm boundary: vapor cannot remain condensed above this temperature. */
  warmK: number;
  /** Cold boundary: below this, the reservoir freezes out rather than
   * sustaining an optically active cloud layer. */
  coldK: number;
}

export interface AtmosphericLayer {
  baseAltitudeKm: number;
  topAltitudeKm: number;
  /** Fraction of the material's thermal condensation interval crossed by
   * the atmosphere, useful as a continuous cloud-strength control. */
  thermalFraction: number;
}

/** Locate the part of an atmosphere whose temperature lies in a material's
 * condensation band. Pressure falls exponentially with scale height; the
 * search stops once only one part per million of the surface column remains,
 * where a macroscopic visible deck is no longer supportable. */
export function condensationLayer(
  atmosphere: PlanetAtmosphere,
  climate: PlanetClimate,
  bulk: PlanetBulk,
  band: CondensationBand,
): AtmosphericLayer | null {
  if (atmosphere.class === 'none' || atmosphere.surfacePressureBar <= 0) return null;

  const surfaceK = climate.surfaceMeanK;
  const ceilingK = skinTemperatureK(climate.equilibriumK);
  if (ceilingK >= band.warmK || surfaceK <= band.coldK) return null;

  const lapse = dryLapseRateKPerKm(atmosphere, bulk);
  if (lapse <= 0) return null;
  const pressureTopKm = Math.max(atmosphere.scaleHeightKm, 0.1) * Math.log(1e6);
  const altitudeAt = (temperatureK: number): number =>
    Math.max(0, (surfaceK - temperatureK) / lapse);
  const baseAltitudeKm = Math.min(pressureTopKm, altitudeAt(band.warmK));
  const topAltitudeKm = Math.min(pressureTopKm, altitudeAt(Math.max(band.coldK, ceilingK)));
  if (topAltitudeKm <= baseAltitudeKm + 0.1) return null;

  const warmest = Math.min(surfaceK, band.warmK);
  const coldest = Math.max(ceilingK, band.coldK);
  return {
    baseAltitudeKm,
    topAltitudeKm,
    thermalFraction: Math.min(
      1,
      Math.max(0, (warmest - coldest) / Math.max(band.warmK - band.coldK, 1)),
    ),
  };
}

/** Fraction of an exposed silicate surface that is molten at its mean
 * temperature. Spatial temperature variation keeps the endpoints soft. */
export function silicateMeltFraction(surfaceMeanK: number): number {
  return Math.min(
    0.95,
    Math.max(0, (surfaceMeanK - SILICATE_SOLIDUS_K) /
      (SILICATE_LIQUIDUS_K - SILICATE_SOLIDUS_K)),
  );
}
