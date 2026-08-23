import { C_LIGHT, H_PLANCK, K_B } from '../physics/constants';

/**
 * Planck spectral radiance B(λ, T) in W·sr⁻¹·m⁻³.
 * wavelength in meters, temperature in kelvin.
 */
export function planckRadiance(wavelength: number, temperature: number): number {
  const hcOverLambdaKT = (H_PLANCK * C_LIGHT) / (wavelength * K_B * temperature);
  const numerator = (2 * H_PLANCK * C_LIGHT * C_LIGHT) / wavelength ** 5;
  return numerator / Math.expm1(hcOverLambdaKT);
}
