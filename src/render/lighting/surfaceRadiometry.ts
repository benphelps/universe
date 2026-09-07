import { stellarBandRgb, type StellarResponse } from '../../core/color/stellarLight';
import { AU, SOLAR_LUMINOSITY } from '../../core/physics/constants';

export const SOLAR_IRRADIANCE_W_M2 = SOLAR_LUMINOSITY / (4 * Math.PI * AU ** 2);
/** White Lambertian reference: solar irradiance / pi. Both reflected
 * irradiance and hemispheric thermal flux divide by pi, so it cancels.
 * Keep the same optical-power RGB convention as galaxy photometry. */
export const SOLAR_OPTICAL_RGB_UNIT = Math.max(...stellarBandRgb(1, 5772));

export function surfaceBandRgb(fluxInSolarIrradiance: number, temperatureK: number, response?: StellarResponse): [number, number, number] {
  const rgb = stellarBandRgb(fluxInSolarIrradiance, temperatureK, response);
  return rgb.map(c => c / SOLAR_OPTICAL_RGB_UNIT) as [number, number, number];
}

/** A single, linear exposure shared by all surface sources in a scene.
 * Settle on the host's mean bolometric illumination, preserving the old
 * daylight adaptation. Limit dark-scene gain to 10,000; adaptation must
 * not turn a cool infrared source into a bright visible sun. Variability,
 * secondary sources and emission are added at full physical contrast. */
export function surfaceLightExposure(referenceInstellation: number): number {
  return Math.max(Number.isFinite(referenceInstellation) ? referenceInstellation : 1, 1e-5) ** -0.8;
}
