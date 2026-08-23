import { planckRadiance } from './planck';
import { gamutMap, normalizeToPeak, xyzToLinearSrgb, type LinearRgb } from './srgb';
import { spectrumToXyz, xyzToChromaticity, type Chromaticity } from './xyz';

/** Chromaticity of a blackbody at temperature T (the Planckian locus). */
export function blackbodyChromaticity(temperature: number): Chromaticity {
  const xyz = spectrumToXyz((nm) => planckRadiance(nm * 1e-9, temperature));
  return xyzToChromaticity(xyz);
}

/** Peak-normalized linear sRGB hue of a blackbody (luminance carried separately). */
export function blackbodyLinearRgb(temperature: number): LinearRgb {
  const xyz = spectrumToXyz((nm) => planckRadiance(nm * 1e-9, temperature));
  return normalizeToPeak(gamutMap(xyzToLinearSrgb(xyz)));
}

/**
 * Temperature→color LUT parameterized in mired (10⁶/T), which spreads
 * perceptual variation evenly: index 0 = hottest, 1 = coolest.
 */
export const LUT_MIRED_MIN = 20; // 50,000 K
export const LUT_MIRED_MAX = 1000; // 1,000 K

export function temperatureToLutCoord(temperature: number): number {
  const mired = 1e6 / Math.max(temperature, 1);
  return Math.min(1, Math.max(0, (mired - LUT_MIRED_MIN) / (LUT_MIRED_MAX - LUT_MIRED_MIN)));
}

export function buildTemperatureLut(size = 256): Float32Array {
  const lut = new Float32Array(size * 4);
  for (let i = 0; i < size; i++) {
    const mired = LUT_MIRED_MIN + ((LUT_MIRED_MAX - LUT_MIRED_MIN) * i) / (size - 1);
    const rgb = blackbodyLinearRgb(1e6 / mired);
    lut[i * 4] = rgb[0];
    lut[i * 4 + 1] = rgb[1];
    lut[i * 4 + 2] = rgb[2];
    lut[i * 4 + 3] = 1;
  }
  return lut;
}
