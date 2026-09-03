import { blackbodyLinearRgb } from '../../core/color/blackbody';
import {
  AU,
  SIGMA_SB,
  SOLAR_LUMINOSITY,
} from '../../core/physics/constants';
import { adapted } from './starlight';

const SOLAR_IRRADIANCE_W_M2 = SOLAR_LUMINOSITY / (4 * Math.PI * AU ** 2);

export interface ThermalEmission {
  /** Peak-normalized Planckian hue in linear sRGB. */
  color: [number, number, number];
  /** Display-adapted radiance relative to direct sunlight at one AU. */
  strength: number;
}

/** A diffuse blackbody emits sigma*T^4/pi radiance. Surface lighting uses
 * direct solar irradiance at one AU as its unit, so this puts an incandescent
 * surface and reflected starlight on the same scale before the shared visual
 * adaptation is applied. */
export function blackbodySurfaceEmission(temperatureK: number): ThermalEmission {
  const temperature = Math.max(temperatureK, 1);
  const radianceRelativeToSunlight =
    (SIGMA_SB * temperature ** 4) / (Math.PI * SOLAR_IRRADIANCE_W_M2);
  return {
    color: blackbodyLinearRgb(temperature),
    strength: adapted(radianceRelativeToSunlight),
  };
}
