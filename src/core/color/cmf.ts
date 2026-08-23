/**
 * CIE 1931 2° color-matching functions via the multi-lobe Gaussian fits of
 * Wyman, Sloan & Shirley (JCGT 2013). Max error vs the tabulated CMFs is
 * well under 1% of peak — ample for chromaticity work. Wavelengths in nm.
 */
function lobe(x: number, mean: number, sigmaLo: number, sigmaHi: number): number {
  const sigma = x < mean ? sigmaLo : sigmaHi;
  const t = (x - mean) / sigma;
  return Math.exp(-0.5 * t * t);
}

export function xBar(wavelength: number): number {
  return (
    1.056 * lobe(wavelength, 599.8, 37.9, 31.0) +
    0.362 * lobe(wavelength, 442.0, 16.0, 26.7) -
    0.065 * lobe(wavelength, 501.1, 20.4, 26.2)
  );
}

export function yBar(wavelength: number): number {
  return 0.821 * lobe(wavelength, 568.8, 46.9, 40.5) + 0.286 * lobe(wavelength, 530.9, 16.3, 31.1);
}

export function zBar(wavelength: number): number {
  return 1.217 * lobe(wavelength, 437.0, 11.8, 36.0) + 0.681 * lobe(wavelength, 459.0, 26.0, 13.8);
}

export const VISIBLE_MIN_NM = 380;
export const VISIBLE_MAX_NM = 780;
