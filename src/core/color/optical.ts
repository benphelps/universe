import { spectrumToXyz } from './xyz';
import { planckRadiance } from './planck';
import { gamutMap, xyzToLinearSrgb, type LinearRgb } from './srgb';
import { SIGMA_SB } from '../physics/constants';

/** Integrated 380–780 nm power / bolometric power. Midpoint Planck
 * quadrature; π converts radiance to hemispheric surface flux. */
export function opticalLuminosityFraction(temperature: number): number {
  if (!(temperature > 0)) return 0;
  let flux = 0;
  for (let i = 0; i < 80; i++) flux += Math.PI * planckRadiance((380 + (i + 0.5) * 5) * 1e-9, temperature) * 5e-9;
  return flux / (SIGMA_SB * temperature ** 4);
}

export function rgbLuminance(rgb: readonly number[]): number {
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

/** Optical-power RGB proxy per unit bolometric luminosity. The CIE
 * chromaticity is normalized so RGB luminance equals integrated optical
 * power, matching the nebula continuum convention. RGB channels are NOT
 * disjoint passbands or Johnson magnitudes; extinction is a three-channel
 * approximation. In particular, peak-normalizing this loses real power. */
export function blackbodyOpticalRgb(temperature: number): LinearRgb {
  return opticalSampleToRgb(opticalSample(temperature));
}

// Interpolate the smooth, unmapped response. Gamut boundaries have
// derivative corners: interpolating already mapped hues creates spurious
// blue light around 1900 K and needlessly stresses population quadrature.
export function opticalSample(temperature: number): [number, number, number, number] {
  const fraction = opticalLuminosityFraction(temperature);
  if (!(fraction > 0)) return [0, 0, 0, 0];
  const xyz = spectrumToXyz(nm => planckRadiance(nm * 1e-9, temperature));
  const rgb = xyzToLinearSrgb(xyz);
  const normalization = Math.PI * 1e-9 / (SIGMA_SB * temperature ** 4);
  return [rgb[0] * normalization, rgb[1] * normalization, rgb[2] * normalization, fraction];
}
function opticalSampleToRgb(sample: readonly number[]): LinearRgb {
  const rgb = gamutMap([sample[0], sample[1], sample[2]]);
  const y = rgbLuminance(rgb), scale = y > 0 ? Math.max(0, sample[3]) / y : 0;
  return [rgb[0] * scale, rgb[1] * scale, rgb[2] * scale];
}

/** Explicitly constructed lookup for offline population quadrature. No
 * integration or table allocation happens during production module load.
 * Cubic interpolation avoids linear-table derivative corners driving the
 * adaptive mass integrator. Log T spans dwarfs through hot remnants. */
export function opticalRgbInterpolator(): (temperature: number) => LinearRgb {
  const count = 2048, minLog = Math.log(100), span = Math.log(1e7 / 100);
  const values = Array.from({ length: count + 3 }, (_, i) => opticalSample(Math.exp(minLog + (i - 1) * span / (count - 1))));
  return temperature => {
    if (!(temperature > 0)) return [0, 0, 0];
    if (temperature < 100 || temperature > 1e7) return blackbodyOpticalRgb(temperature);
    const coord = (Math.log(temperature) - minLog) * (count - 1) / span;
    const index = Math.min(count - 2, Math.floor(coord)), t = coord - index;
    const a = values[index], b = values[index + 1], c = values[index + 2], d = values[index + 3];
    const channel = (k: number) => b[k] + 0.5 * t * (c[k] - a[k] + t * (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]
      + t * (3 * (b[k] - c[k]) + d[k] - a[k])));
    return opticalSampleToRgb([channel(0), channel(1), channel(2), channel(3)]);
  };
}
