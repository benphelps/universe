import { SIGMA_SB } from '../../core/physics/constants';
import { SOLAR_IRRADIANCE_W_M2, surfaceBandRgb } from './surfaceRadiometry';

export interface ThermalEmission {
  /** Peak-normalized hue, with absolute band power retained in strength. */
  color: [number, number, number];
  /** Linear radiance / white Lambertian sunlight at one AU; no exposure. */
  strength: number;
}

/** Visible Planck radiance in the same units as reflected starlight.
 * Bolometric heat alone cannot set visible brightness: most cool-body
 * power is infrared. Exposure and emissivity belong to the combined light. */
export function blackbodySurfaceEmission(temperatureK: number): ThermalEmission {
  const temperature = Number.isFinite(temperatureK) ? Math.max(temperatureK, 0) : 0;
  const rgb = surfaceBandRgb(SIGMA_SB * temperature ** 4 / SOLAR_IRRADIANCE_W_M2, temperature);
  const strength = Math.max(...rgb);
  return { color: strength > 0 ? rgb.map(c => c / strength) as [number, number, number] : [0, 0, 0], strength };
}
