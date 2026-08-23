import { VISIBLE_MAX_NM, VISIBLE_MIN_NM, xBar, yBar, zBar } from './cmf';

export interface Xyz {
  x: number;
  y: number;
  z: number;
}

export interface Chromaticity {
  x: number;
  y: number;
}

const STEP_NM = 5;

/**
 * Integrate a spectral power distribution (wavelength in nm → relative power)
 * against the CIE 1931 CMFs over the visible band.
 */
export function spectrumToXyz(spectrum: (wavelengthNm: number) => number): Xyz {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let nm = VISIBLE_MIN_NM; nm <= VISIBLE_MAX_NM; nm += STEP_NM) {
    const power = spectrum(nm);
    x += power * xBar(nm);
    y += power * yBar(nm);
    z += power * zBar(nm);
  }
  return { x: x * STEP_NM, y: y * STEP_NM, z: z * STEP_NM };
}

export function xyzToChromaticity(xyz: Xyz): Chromaticity {
  const sum = xyz.x + xyz.y + xyz.z;
  if (sum === 0) return { x: 0.3127, y: 0.329 };
  return { x: xyz.x / sum, y: xyz.y / sum };
}
