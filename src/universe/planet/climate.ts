import { logNormal } from '../../core/rng/distributions';
import type { Rng } from '../../core/rng/rng';
import type { PlanetClass } from '../system/types';
import type {
  Hydrosphere,
  PlanetAtmosphere,
  PlanetClimate,
  PlanetInterior,
  PlanetRotation,
} from './types';

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
  interior: PlanetInterior,
  rotation: PlanetRotation,
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

  for (let iteration = 0; iteration < 12; iteration++) {
    const equilibriumK = T_EQ_1AU * instellation ** 0.25 * (1 - bondAlbedo) ** 0.25;
    surfaceMeanK = equilibriumK * (1 + 0.75 * atmosphere.opticalDepth) ** 0.25;

    if (envelope) {
      // No surface: report the cloud-top temperature instead.
      surfaceMeanK = equilibriumK;
      break;
    }
    if (interior.regime === 'magma') {
      hydrosphere = 'magma';
      break;
    }

    // Polar temperature falls below the mean; thick atmospheres transport heat.
    const transport = Math.min(1, atmosphere.surfacePressureBar) * 0.6;
    const poleDeltaK = 55 * (1 - 0.6 * transport);
    // Permanent ice needs annual means ~10 K below freezing.
    const capFreezeK = 263;
    const fullFreezeK = 266;
    const boilK = 373 * Math.min(1.5, Math.max(0.75, atmosphere.surfacePressureBar ** 0.08));

    const hasWater = waterMassFraction > 3e-5;
    const wasHydrosphere: Hydrosphere = hydrosphere;
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

    const iceFraction = 1 - Math.sin(iceCapLatitudeRad);
    snowball = hydrosphere === 'ice-sheet';
    const cloudAlbedo =
      atmosphere.class === 'co2-hothouse'
        ? 0.5
        : 0.18 * Math.min(1, atmosphere.surfacePressureBar) * (oceanCoverage > 0 ? 1 : 0.3);
    const surfaceAlbedo = 0.15 * (1 - oceanCoverage) + 0.06 * oceanCoverage;
    const next = Math.min(
      0.75,
      surfaceAlbedo * (1 - iceFraction) + 0.45 * iceFraction + cloudAlbedo,
    );
    if (Math.abs(next - bondAlbedo) < 0.005 && wasHydrosphere === hydrosphere) break;
    bondAlbedo = bondAlbedo * 0.5 + next * 0.5;
  }

  const equilibriumK = T_EQ_1AU * instellation ** 0.25 * (1 - bondAlbedo) ** 0.25;

  // Locked worlds: redistribution efficiency sets the day–night contrast.
  const redistribution = Math.min(1, atmosphere.surfacePressureBar * 0.8);
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
  };
}
