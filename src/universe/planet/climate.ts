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
import { globalSilicateMeltFraction } from './thermodynamics';
import { atmosphericBondAlbedo } from './atmosphere';

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
): PlanetClimate {
  const instellation = luminosity / aAu ** 2;
  const envelope = atmosphere.class === 'hydrogen-helium';

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
    const equilibriumK = T_EQ_1AU * instellation ** 0.25 * (1 - bondAlbedo) ** 0.25;

    if (thermostatActive && equilibriumK > 175) {
      const targetTau =
        ((thermostatTargetK / Math.max(equilibriumK, 1)) ** 4 - 1) / 0.75;
      const neededBar =
        (Math.max(0, targetTau - atmosphere.opticalDepth) / 5.8) ** (1 / 0.7);
      co2Bar = co2Bar * 0.5 + Math.min(co2CapBar, neededBar) * 0.5;
    }
    const opticalDepth = atmosphere.opticalDepth + 5.8 * co2Bar ** 0.7;
    const pressureBar = atmosphere.surfacePressureBar + co2Bar;
    surfaceMeanK = equilibriumK * (1 + 0.75 * opticalDepth) ** 0.25;

    if (envelope) {
      // No surface: report the cloud-top temperature instead.
      surfaceMeanK = equilibriumK;
      break;
    }
    const wasHydrosphere: Hydrosphere = hydrosphere;
    const redistribution = Math.min(1, pressureBar * 0.8);
    const thermalContrastK = rotation.locked
      ? equilibriumK * 0.9 * (1 - redistribution)
      : 0;
    const irradiationMelt = globalSilicateMeltFraction(surfaceMeanK, thermalContrastK);
    if (interior.regime === 'magma' || irradiationMelt > 0) {
      hydrosphere = 'magma';
      // Exposed-melt fraction: the crust closes over as the flux falls
      // toward the magma threshold (2 W/m²), and irradiation past the
      // silicate solidus melts it open again from above.
      const fluxMelt = 0.15 + 0.45 * Math.log10(interior.heatFluxWm2 / 2);
      oceanCoverage = Math.min(1, Math.max(0.05, fluxMelt, irradiationMelt));
      iceCapLatitudeRad = Math.PI / 2;
    } else {
      // Polar temperature falls below the mean; thick atmospheres transport heat.
      const transport = Math.min(1, pressureBar) * 0.6;
      const poleDeltaK = 55 * (1 - 0.6 * transport);
      // Permanent ice needs annual means ~10 K below freezing.
      const capFreezeK = 263;
      const fullFreezeK = 266;
      const boilK = 373 * Math.min(1.5, Math.max(0.75, pressureBar ** 0.08));

      const hasWater = waterMassFraction > 3e-5;
      if (!hasWater || atmosphere.class === 'none' || surfaceMeanK > boilK) {
        hydrosphere = 'none';
        iceCapLatitudeRad = Math.PI / 2;
        oceanCoverage = 0;
      } else if (surfaceMeanK < fullFreezeK) {
        hydrosphere = 'ice-sheet';
        iceCapLatitudeRad = 0;
        oceanCoverage = 0;
      } else {
        hydrosphere = 'oceans';
        oceanCoverage = Math.min(1, (waterMassFraction / 4e-4) * 0.71);
        // Caps extend equatorward until the freeze line: T(φ) ≈ T_s − ΔT·sin²φ.
        const sinSq = (surfaceMeanK - capFreezeK) / Math.max(poleDeltaK, 1);
        iceCapLatitudeRad = sinSq >= 1 ? Math.PI / 2 : Math.asin(Math.sqrt(Math.max(0, sinSq)));
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
      : atmosphericBondAlbedo(atmosphere, bulk, incidentRgb, surfaceExposure);
    // Adding-doubling for an atmosphere over a reflecting lower boundary:
    // the down-and-up transmission is (1-A)^2 and repeated bounces form the
    // denominator. No atmosphere class is assigned a predetermined albedo.
    const next = airAlbedo +
      ((1 - airAlbedo) ** 2 * lowerAlbedo) /
        Math.max(1 - airAlbedo * lowerAlbedo, 1e-6);
    if (Math.abs(next - bondAlbedo) < 0.005 && wasHydrosphere === hydrosphere) break;
    bondAlbedo = bondAlbedo * 0.5 + next * 0.5;
  }

  const equilibriumK = T_EQ_1AU * instellation ** 0.25 * (1 - bondAlbedo) ** 0.25;
  if (!envelope) {
    const opticalDepth = atmosphere.opticalDepth + 5.8 * co2Bar ** 0.7;
    surfaceMeanK = equilibriumK * (1 + 0.75 * opticalDepth) ** 0.25;
  }

  // Locked worlds: redistribution efficiency sets the day–night contrast.
  const redistribution = Math.min(1, (atmosphere.surfacePressureBar + co2Bar) * 0.8);
  const dayNightDeltaK = rotation.locked ? equilibriumK * 0.9 * (1 - redistribution) : 0;

  const biosphere =
    hydrosphere === 'oceans' &&
    (atmosphere.class === 'nitrogen' || atmosphere.class === 'nitrogen-oxygen') &&
    ageGyr > 1.5 &&
    rng.bool(0.35);

  return {
    equilibriumK,
    surfaceMeanK,
    bondAlbedo,
    iceCapLatitudeRad,
    hydrosphere,
    oceanCoverage,
    dayNightDeltaK,
    snowball,
    biosphere,
    co2Bar,
  };
}
