import type { Vec3 } from '../../core/math/vec3';

/** Immutable rotational climatology. Store nonlinear seasonal cooling
 * separately from mean radiative power, preserving cold polar horizons.
 * Angles are colatitude in radians; end nodes are the actual poles. */
export interface AnnualMeanField {
  angles: Float64Array;
  ratios: Float64Array;
  fourthK4: Float64Array;
  meanK: number;
  minimumK: number;
  maximumK: number;
  iceFraction: number;
  diagnostics: { pointSolves: number; maximumProbeErrorK: number; toleranceK: number };
}

export function interpolateAnnualMean(aRatio: number, bRatio: number, aFourth: number, bFourth: number, f: number): number {
  return (aRatio * (1 - f) + bRatio * f) * Math.sqrt(Math.sqrt(Math.max(0, aFourth * (1 - f) + bFourth * f)));
}
export function annualMeanAtAngle(field: AnnualMeanField, angle: number): number {
  let lo = 0, hi = field.angles.length - 1;
  while (lo + 1 < hi) { const m = (lo + hi) >>> 1; if (field.angles[m] <= angle) lo = m; else hi = m; }
  const f = Math.max(0, Math.min(1, (angle - field.angles[lo]) / (field.angles[hi] - field.angles[lo])));
  return interpolateAnnualMean(field.ratios[lo], field.ratios[hi], field.fourthK4[lo], field.fourthK4[hi], f);
}
export function annualMeanTemperatureAt(field: AnnualMeanField, dir: Vec3): number {
  return annualMeanAtAngle(field, Math.acos(Math.max(-1, Math.min(1, dir.y))));
}
export function annualMeanFieldBytes(field: AnnualMeanField): number {
  return field.angles.byteLength + field.ratios.byteLength + field.fourthK4.byteLength;
}

