import type { Xyz } from './xyz';

export type LinearRgb = [number, number, number];

/** XYZ (D65) → linear sRGB. */
export function xyzToLinearSrgb(xyz: Xyz): LinearRgb {
  const { x, y, z } = xyz;
  return [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
}

/**
 * Bring an out-of-gamut color inside by adding white (equal channel lift),
 * which desaturates without the hue shift of per-channel clamping.
 */
export function gamutMap(rgb: LinearRgb): LinearRgb {
  const min = Math.min(rgb[0], rgb[1], rgb[2]);
  if (min >= 0) return rgb;
  return [rgb[0] - min, rgb[1] - min, rgb[2] - min];
}

/** Scale so the largest channel is 1 (hue/saturation only; luminance carried separately). */
export function normalizeToPeak(rgb: LinearRgb): LinearRgb {
  const max = Math.max(rgb[0], rgb[1], rgb[2]);
  if (max <= 0) return [0, 0, 0];
  return [rgb[0] / max, rgb[1] / max, rgb[2] / max];
}

export function linearToSrgbChannel(c: number): number {
  const clamped = Math.min(1, Math.max(0, c));
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

export function linearToSrgb(rgb: LinearRgb): LinearRgb {
  return [linearToSrgbChannel(rgb[0]), linearToSrgbChannel(rgb[1]), linearToSrgbChannel(rgb[2])];
}
