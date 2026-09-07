import type { AtmosphereClass, PlanetAtmosphere, PlanetBulk, PlanetClimate } from './types';
import { EARTH_RADIUS, K_B, SIGMA_SB } from '../../core/physics/constants';
import { columnAltitudeAtPressureFraction, columnTemperatureK, columnStateAt, type HydrostaticColumn } from './hydrostaticColumn';
import { waterSaturationPa } from './waterPhase';

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
  return (bulk.gravityMs2 * 1000) / (atmosphere.specificHeatJkgK ?? SPECIFIC_HEAT_J_KG_K[atmosphere.class]);
}

export interface AtmosphericColumn extends HydrostaticColumn {
  meanMolecularMassAmu: number;
  specificHeatJkgK: number;
  /** Conservative diagnostic screen, not a calibrated equation-of-state
   * validity boundary. Dense/hot/extended columns retain an explicit estimate. */
  regime: 'dry-ideal-gas' | 'extrapolated-ideal-gas';
}

/** Analytic hydrostatics for the existing prescribed dry lapse and gray skin
 * cap. Construct from the FINAL mixture, never cache inside a mutable gas
 * inventory. The local datum temperature may replace the annual mean.
 * This does not solve radiative-convective equilibrium or phase chemistry.
 * Envelopes have no modeled pressure-level temperature, so return no column. */
export function atmosphericColumnProfile(
  atmosphere: PlanetAtmosphere, climate: PlanetClimate, bulk: PlanetBulk,
  localSurfaceK = climate.surfaceMeanK,
): AtmosphericColumn | null {
  if (atmosphere.class === 'none' || atmosphere.class === 'hydrogen-helium' || atmosphere.surfacePressureBar <= 0) return null;
  const gasR = (atmosphere.meanMolecularMassAmu ?? 0) > 0
    ? K_B / (atmosphere.meanMolecularMassAmu! * 1.66054e-27)
    // Only hand-authored legacy fixtures lack the molecular inventory.
    : atmosphere.scaleHeightKm * 1000 * bulk.gravityMs2 / climate.surfaceMeanK;
  const lapse = dryLapseRateKPerKm(atmosphere, bulk) / 1000;
  const cap = Math.min(localSurfaceK, skinTemperatureK(climate.effectiveK ?? climate.equilibriumK));
  if (![gasR, bulk.gravityMs2, localSurfaceK, cap, atmosphere.surfacePressureBar, lapse].every(v => Number.isFinite(v) && v > 0)) return null;
  const extended = gasR * localSurfaceK / bulk.gravityMs2 > 0.02 * bulk.radiusEarth * EARTH_RADIUS;
  return {
    surfacePressurePa: atmosphere.surfacePressureBar * 1e5,
    surfaceTemperatureK: localSurfaceK, capTemperatureK: cap,
    gasConstantJkgK: gasR, gravityMs2: bulk.gravityMs2, lapseKPerM: lapse,
    meanMolecularMassAmu: K_B / (gasR * 1.66054e-27), specificHeatJkgK: bulk.gravityMs2 / lapse,
    // These deliberately narrow reporting bounds mark an extrapolation;
    // even within them the gas remains a constant-cp ideal approximation.
    regime: atmosphere.surfacePressureBar > 10 || localSurfaceK < 100 || localSurfaceK > 1000 || extended
      ? 'extrapolated-ideal-gas' : 'dry-ideal-gas',
  };
}

/** The prescribed dry temperature branch, shared by clouds and terrain. */
export function atmosphericTemperatureK(
  atmosphere: PlanetAtmosphere,
  climate: PlanetClimate,
  bulk: PlanetBulk,
  altitudeKm: number,
): number {
  const lapse = dryLapseRateKPerKm(atmosphere, bulk);
  return columnTemperatureK(climate.surfaceMeanK,
    skinTemperatureK(climate.effectiveK ?? climate.equilibriumK), lapse / 1000, altitudeKm * 1000);
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

/** Candidate saturation interval in the prescribed background column.
 * A lifted, initially well-mixed vapor supply must actually supersaturate;
 * temperature alone does not produce a cloud. No moist adjustment or
 * rainout is claimed by this admissibility check. */
export function waterCondensationLayer(atmosphere: PlanetAtmosphere, climate: PlanetClimate, bulk: PlanetBulk): AtmosphericLayer | null {
  const water = atmosphere.waterReservoir;
  if (water?.status !== 'dilute' || !(water.vaporKgM2! > 0 && water.condensedKgM2! > 0)) return null;
  const fraction = (atmosphere.partialPressuresBar?.H2O ?? 0) / atmosphere.surfacePressureBar;
  const column = atmosphericColumnProfile(atmosphere, climate, bulk);
  if (!column || !(fraction > 0)) return null;
  // The stable isothermal cap cold-traps rising water. Extending the
  // surface mixing ratio through it would invent a stratospheric deck.
  const convectiveTop = (column.surfaceTemperatureK - column.capTemperatureK) / column.lapseKPerM;
  const height = Math.min(columnAltitudeAtPressureFraction(column, 1e-6), convectiveTop);
  if (!(height > 100)) return null;
  const score = (z: number) => {
    const s = columnStateAt(column, z), saturation = waterSaturationPa(s.temperatureK);
    return saturation !== null && saturation > 0 ? Math.log(fraction * s.pressurePa / saturation) : -Infinity;
  };
  const crossing = (low: number, high: number, rising: boolean) => {
    for (let i = 0; i < 12; i++) {
      const mid = (low + high) * 0.5;
      if ((score(mid) >= 0) === rising) high = mid; else low = mid;
    }
    return (low + high) * 0.5;
  };
  let base: number | undefined, top: number | undefined, previous = score(0);
  if (previous >= 0) base = 0;
  for (let i = 1; i <= 32; i++) {
    const z = i / 32 * height, current = score(z), low = (i - 1) / 32 * height;
    if (base === undefined && current >= 0) base = crossing(low, z, true);
    if (base !== undefined && previous >= 0 && current < 0) { top = crossing(low, z, false); break; }
    previous = current;
  }
  if (base === undefined) return null;
  top ??= height;
  return top - base > 100 ? { baseAltitudeKm: base / 1000, topAltitudeKm: top / 1000, thermalFraction: 1 } : null;
}

/** Locate the part of an atmosphere whose temperature lies in a material's
 * condensation band. Pressure follows the same dry temperature profile; the
 * search stops once only one part per million of the surface column remains,
 * where a macroscopic visible deck is no longer supportable. */
export function condensationLayer(
  atmosphere: PlanetAtmosphere,
  climate: PlanetClimate,
  bulk: PlanetBulk,
  band: CondensationBand,
): AtmosphericLayer | null {
  const column = atmosphericColumnProfile(atmosphere, climate, bulk);
  if (!column) return null;

  const surfaceK = climate.surfaceMeanK;
  const ceilingK = column.capTemperatureK;
  if (ceilingK >= band.warmK || surfaceK <= band.coldK) return null;

  const lapse = dryLapseRateKPerKm(atmosphere, bulk);
  if (lapse <= 0) return null;
  const pressureTopKm = columnAltitudeAtPressureFraction(column, 1e-6) / 1000;
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

/** Equilibrium melt fraction of an exposed silicate surface at its mean
 * temperature. Below the solidus it is solid; at and above the liquidus
 * there is no load-bearing crust left for the terrain renderer to expose. */
export function silicateMeltFraction(surfaceMeanK: number): number {
  return Math.min(
    1,
    Math.max(0, (surfaceMeanK - SILICATE_SOLIDUS_K) /
      (SILICATE_LIQUIDUS_K - SILICATE_SOLIDUS_K)),
  );
}

/** Area-mean exposed melt on a synchronously illuminated sphere. The climate
 * model reports the global-mean temperature and its day-to-night drop;
 * equal-area mu=cos(theta) bands turn that field into a global fraction.
 * A redistributed or rotating atmosphere has zero contrast and reduces to the
 * ordinary phase curve above. */
export function globalSilicateMeltFraction(
  meanTemperatureK: number,
  dayNightDeltaK: number,
): number {
  if (dayNightDeltaK <= 0) return silicateMeltFraction(meanTemperatureK);
  const bands = 64;
  let melt = 0;
  for (let i = 0; i < bands; i++) {
    const mu = -1 + (2 * (i + 0.5)) / bands;
    const localTemperatureK = meanTemperatureK + dayNightDeltaK * mu * 0.5;
    melt += silicateMeltFraction(localTemperatureK);
  }
  return melt / bands;
}

/** Fallback temperature for legacy characterization fixtures. Generated
 *  bodies carry their solved hotspot temperature in the climate state. */
export function exposedMagmaTemperatureK(
  surfaceMeanK: number,
  _coverage: number,
): number {
  return Math.max(surfaceMeanK, SILICATE_LIQUIDUS_K);
}

/** Two-temperature gray energy balance. A volcanic world's unresolved
 *  eruptions carry half its internal power (an explicit duty-cycle
 *  approximation); the remainder heats the background. Irradiation can
 *  melt a larger area. The final background closes the same area-weighted
 *  T^4 budget in either case, so lava is never powered by a display rule. */
export function surfaceThermalState(
  equilibriumK: number, internalFluxWm2: number, opticalDepth: number, dayNightDeltaK = 0,
): { effectiveK: number; surfaceMeanK: number; surfaceBackgroundK: number; magmaTemperatureK: number; meltCoverage: number } {
  const heat = Math.max(0, internalFluxWm2);
  const effectiveFourth = equilibriumK ** 4 + heat / SIGMA_SB;
  const greenhouse = 1 + 0.75 * Math.max(0, opticalDepth);
  const surfaceFourth = effectiveFourth * greenhouse;
  const uniformK = surfaceFourth ** 0.25;
  const minimumHotspotK = heat > 2 && uniformK < SILICATE_SOLIDUS_K ? SILICATE_LIQUIDUS_K : SILICATE_SOLIDUS_K;
  const hotspotK = Math.max(minimumHotspotK, uniformK + dayNightDeltaK * 0.5);
  const eruptionFlux = heat > 2 ? heat * 0.5 : 0;
  const diffuseFourth = (equilibriumK ** 4 + (heat - eruptionFlux) / SIGMA_SB) * greenhouse;
  const volcanicCoverage = eruptionFlux * greenhouse /
    Math.max(SIGMA_SB * (hotspotK ** 4 - diffuseFourth), 1e-20);
  const desired = Math.max(globalSilicateMeltFraction(uniformK, dayNightDeltaK), volcanicCoverage);
  const backgroundFloorFourth = Math.max(0, diffuseFourth ** 0.25 - dayNightDeltaK * 0.5) ** 4;
  const maxCoverage = hotspotK ** 4 > backgroundFloorFourth
    ? (surfaceFourth - backgroundFloorFourth) / (hotspotK ** 4 - backgroundFloorFourth)
    : 1;
  const meltCoverage = Math.max(0, Math.min(1, desired, maxCoverage));
  const backgroundK = meltCoverage >= 1
    ? uniformK
    : Math.max(0, (surfaceFourth - meltCoverage * hotspotK ** 4) / (1 - meltCoverage)) ** 0.25;
  return {
    effectiveK: effectiveFourth ** 0.25,
    surfaceMeanK: (1 - meltCoverage) * backgroundK + meltCoverage * hotspotK,
    surfaceBackgroundK: backgroundK,
    magmaTemperatureK: meltCoverage > 0 ? hotspotK : 0,
    meltCoverage,
  };
}
