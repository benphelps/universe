import type { PlanetForcing } from './illumination';
import { annualSurfaceTemperatures, buildAnnualInsolation } from './surfaceClimate';
import { SIGMA_SB } from '../../core/physics/constants';
import { logNormal } from '../../core/rng/distributions';
import type { Rng } from '../../core/rng/rng';
import type { PlanetClass } from '../system/types';
import type {
  Hydrosphere,
  PlanetAtmosphere,
  PlanetBulk,
  PlanetClimate,
  PlanetInterior,
  PlanetRotation,
} from './types';
import { surfaceThermalState } from './thermodynamics';
import { atmosphericBondAlbedo, thermostatCo2ForOpticalDepth, withThermostatCo2, withWaterVapor } from './atmosphere';
import { isStellarSynchronous } from './rotation';
import { waterSaturationPa, WATER_TRIPLE_PA, WATER_TRIPLE_K, WATER_CRITICAL_PA } from './waterPhase';

/** T_eq = 278.6 K at 1 AU around 1 L☉ with zero albedo. */
const T_EQ_1AU = 278.6;

/**
 * Energy-balance climate: equilibrium temperature and Bond albedo are
 * iterated to a fixpoint (ice and clouds raise albedo, cooling the
 * surface, freezing more ice — genuine snowball transitions emerge),
 * then the gray greenhouse sets the surface temperature.
 */
export function computeClimate(
  rng: Rng,
  planetClass: PlanetClass,
  atmosphere: PlanetAtmosphere,
  bulk: PlanetBulk,
  interior: PlanetInterior,
  rotation: PlanetRotation,
  incidentRgb: readonly [number, number, number],
  luminosity: number,
  aAu: number,
  ageGyr: number,
  forcing?: PlanetForcing,
): PlanetClimate {
  const envelope = atmosphere.class === 'hydrogen-helium';
  const insolation = forcing ? buildAnnualInsolation(forcing, rotation, envelope ? 1 : 12) : null;
  const equilibriumAt = (albedo: number) => insolation
    ? ((1 - albedo) * insolation.meanFluxWm2 / SIGMA_SB) ** 0.25
    : T_EQ_1AU * (luminosity / aAu ** 2 * (1 - albedo)) ** 0.25;
  // Water inventory: ice-rich beyond the frost line, trace delivery inside.
  const waterMassFraction =
    planetClass === 'rocky' || planetClass === 'super-earth'
      ? logNormal(rng, Math.log(4e-4), 1)
      : 0.3;

  let bondAlbedo = envelope ? 0.34 : 0.25;
  let surfaceMeanK = 0;
  let hydrosphere: Hydrosphere = 'none';
  let iceCapLatitudeRad = Math.PI / 2;
  let oceanCoverage = 0;
  let snowball = false;
  let co2Bar = 0;

  // Carbonate–silicate thermostat: on geologically active worlds with
  // water, silicate weathering regulates volcanic CO₂ against
  // temperature drift — it shuts off when cold so CO₂ accumulates, and
  // accelerates when warm, drawing it down. This feedback is what makes
  // the outer habitable zone habitable; dead worlds get no regulation,
  // and far enough out the CO₂ itself condenses and the thermostat fails.
  const thermostatActive =
    !envelope &&
    waterMassFraction > 3e-5 &&
    (interior.regime === 'active-tectonics' || interior.regime === 'stagnant-lid') &&
    (atmosphere.class === 'nitrogen' ||
      atmosphere.class === 'nitrogen-oxygen' ||
      atmosphere.class === 'thin-co2');
  const thermostatTargetK = rng.range(279, 295);
  const co2CapBar = 8;

  for (let iteration = 0; iteration < 12; iteration++) {
    const equilibriumK = equilibriumAt(bondAlbedo);

    if (thermostatActive && equilibriumK > 175) {
      const effectiveK = surfaceThermalState(equilibriumK, interior.heatFluxWm2, 0).effectiveK;
      const targetTau = ((thermostatTargetK / Math.max(effectiveK, 1)) ** 4 - 1) / 0.75;
      const neededBar = thermostatCo2ForOpticalDepth(atmosphere, targetTau);
      co2Bar = co2Bar * 0.5 + Math.min(co2CapBar, neededBar) * 0.5;
    }
    const iterationTemperature = Math.max(surfaceMeanK, equilibriumK);
    const iterationAir = withWaterVapor(withThermostatCo2(atmosphere, co2Bar, iterationTemperature, bulk),
      waterMassFraction, iterationTemperature, bulk);
    const opticalDepth = iterationAir.opticalDepth;
    const pressureBar = iterationAir.surfacePressureBar;
    const redistribution = Math.min(1, pressureBar * 0.8);
    const thermalContrastK = isStellarSynchronous(rotation) ? equilibriumK * 0.9 * (1 - redistribution) : 0;
    const thermal = surfaceThermalState(equilibriumK, interior.heatFluxWm2, envelope ? 0 : opticalDepth, thermalContrastK);
    surfaceMeanK = envelope ? thermal.effectiveK : thermal.surfaceMeanK;

    if (envelope) {
      // No surface: report effective temperature, not an invented cloud level.
      break;
    }
    const wasHydrosphere: Hydrosphere = hydrosphere;
    if (thermal.meltCoverage > 0) {
      hydrosphere = 'magma';
      oceanCoverage = thermal.meltCoverage;
      iceCapLatitudeRad = Math.PI / 2;
    } else {
      const field = insolation ? annualSurfaceTemperatures(insolation, bondAlbedo,
        opticalDepth, interior.heatFluxWm2, pressureBar) : null;
      if (field) surfaceMeanK = field.meanK;
      // Legacy fixture fallback; generated worlds use the shared energy field.
      const transport = Math.min(1, pressureBar) * 0.6;
      const poleDeltaK = 55 * (1 - 0.6 * transport);
      // Permanent ice needs annual means ~10 K below freezing.
      const capFreezeK = 263;
      const fullFreezeK = 266;
      // One forward saturation evaluation replaces an iterative inverse
      // boiling solve on every albedo pass during catalog generation.
      const saturationPa = surfaceMeanK < WATER_TRIPLE_K ? 0 : waterSaturationPa(surfaceMeanK);
      const belowBoiling = pressureBar * 1e5 >= WATER_TRIPLE_PA && pressureBar * 1e5 <= WATER_CRITICAL_PA
        && saturationPa !== null && saturationPa <= pressureBar * 1e5;

      const hasWater = waterMassFraction > 3e-5;
      if (!hasWater || atmosphere.class === 'none' || !belowBoiling) {
        hydrosphere = 'none';
        iceCapLatitudeRad = Math.PI / 2;
        oceanCoverage = 0;
      } else if (field ? field.iceFraction >= 1 - 1e-6 : surfaceMeanK < fullFreezeK) {
        hydrosphere = 'ice-sheet';
        iceCapLatitudeRad = 0;
        oceanCoverage = 0;
      } else {
        hydrosphere = 'oceans';
        oceanCoverage = Math.min(1, (waterMassFraction / 4e-4) * 0.71);
        // Caps extend equatorward until the freeze line: T(φ) ≈ T_s − ΔT·sin²φ.
        const sinSq = (surfaceMeanK - capFreezeK) / Math.max(poleDeltaK, 1);
        // Equivalent ice area for albedo/aerosol inventory; ice geography
        // comes from the field and need not be a pair of polar caps.
        iceCapLatitudeRad = field ? Math.asin(1 - field.iceFraction)
          : sinSq >= 1 ? Math.PI / 2 : Math.asin(Math.sqrt(Math.max(0, sinSq)));
      }
    }

    const iceFraction = 1 - Math.sin(iceCapLatitudeRad);
    snowball = hydrosphere === 'ice-sheet';
    const waterCloudAlbedo =
      hydrosphere === 'oceans' ? 0.18 * Math.min(1, pressureBar) : 0;
    const bareAlbedo = hydrosphere === 'magma' ? 0.1 : 0.15;
    const surfaceAlbedo = bareAlbedo * (1 - oceanCoverage) + 0.06 * oceanCoverage;
    const lowerAlbedo = Math.min(
      0.95,
      surfaceAlbedo * (1 - iceFraction) + 0.45 * iceFraction + waterCloudAlbedo,
    );
    // A thin CO₂ atmosphere's mineral aerosol can only be replenished
    // from exposed ground. As ice advances, the dust column and its
    // reflected share disappear continuously inside the same albedo
    // iteration instead of remaining a fixed Mars-colored veil.
    const surfaceExposure = Math.sin(iceCapLatitudeRad);
    const airAlbedo = envelope
      ? 0
      : atmosphericBondAlbedo(iterationAir, bulk, incidentRgb, surfaceExposure);
    // Adding-doubling for an atmosphere over a reflecting lower boundary:
    // the down-and-up transmission is (1-A)^2 and repeated bounces form the
    // denominator. No atmosphere class is assigned a predetermined albedo.
    const next = airAlbedo +
      ((1 - airAlbedo) ** 2 * lowerAlbedo) /
        Math.max(1 - airAlbedo * lowerAlbedo, 1e-6);
    if (Math.abs(next - bondAlbedo) < 0.005 && wasHydrosphere === hydrosphere) break;
    bondAlbedo = bondAlbedo * 0.5 + next * 0.5;
  }

  const equilibriumK = equilibriumAt(bondAlbedo);

  // Locked worlds: redistribution efficiency sets the day–night contrast.
  const redistribution = Math.min(1, (atmosphere.surfacePressureBar + co2Bar) * 0.8);
  const dayNightDeltaK = isStellarSynchronous(rotation) ? equilibriumK * 0.9 * (1 - redistribution) : 0;
  const finalAir = withWaterVapor(withThermostatCo2(atmosphere, co2Bar, surfaceMeanK, bulk), waterMassFraction, surfaceMeanK, bulk);
  const thermal = surfaceThermalState(equilibriumK, interior.heatFluxWm2,
    envelope ? 0 : finalAir.opticalDepth, envelope ? 0 : dayNightDeltaK);
  surfaceMeanK = envelope ? thermal.effectiveK : thermal.surfaceMeanK;
  if (!envelope && thermal.meltCoverage > 0) {
    hydrosphere = 'magma';
    oceanCoverage = thermal.meltCoverage;
    iceCapLatitudeRad = Math.PI / 2;
    snowball = false;
  }

  const surfaceField = insolation && !envelope && thermal.meltCoverage === 0
    ? annualSurfaceTemperatures(insolation, bondAlbedo, finalAir.opticalDepth,
      interior.heatFluxWm2, finalAir.surfacePressureBar) : undefined;
  if (surfaceField) {
    surfaceMeanK = surfaceField.meanK;
    if ((hydrosphere === 'oceans' || hydrosphere === 'ice-sheet') && finalAir.surfacePressureBar * 1e5 >= WATER_TRIPLE_PA) {
      iceCapLatitudeRad = Math.asin(1 - surfaceField.iceFraction);
      snowball = surfaceField.iceFraction >= 1 - 1e-6;
      hydrosphere = snowball ? 'ice-sheet' : 'oceans';
      oceanCoverage = snowball ? 0 : Math.min(1, (waterMassFraction / 4e-4) * 0.71);
    }
  }

  const biosphere =
    hydrosphere === 'oceans' &&
    (atmosphere.class === 'nitrogen' || atmosphere.class === 'nitrogen-oxygen') &&
    ageGyr > 1.5 &&
    rng.bool(0.35);

  return {
    surfaceField,
    waterMassFraction,
    equilibriumK,
    effectiveK: thermal.effectiveK,
    surfaceBackgroundK: envelope ? thermal.effectiveK : thermal.surfaceBackgroundK,
    magmaTemperatureK: envelope ? 0 : thermal.magmaTemperatureK,
    surfaceMeanK,
    bondAlbedo,
    iceCapLatitudeRad,
    hydrosphere,
    oceanCoverage,
    dayNightDeltaK: surfaceField && isStellarSynchronous(rotation) ? surfaceField.maximumK - surfaceField.minimumK : dayNightDeltaK,
    snowball,
    biosphere,
    co2Bar,
  };
}
