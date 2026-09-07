import { armBoost } from './density';
import { SPIRAL_LIMITS } from './spiralStructure';

/** Bounded inverse CDF for overview grain. Radius is sampled separately from
 * the conserved exponential disc. Conditional azimuth follows that disc's
 * actual stellar contrast, including inter-arm depletion. No rejection loop
 * or independent orbital placement. This is a tracer, not a star catalogue. */
export function spiralAzimuthSampler(): (radiusPc: number, unit: number) => number {
  const radialSteps = 256, angularSteps = 512;
  const stride = angularSteps + 1;
  const table = new Float32Array((radialSteps + 1) * stride);
  for (let row = 0; row <= radialSteps; row++) {
    const r = row * SPIRAL_LIMITS.radiusMaxPc / radialSteps, offset = row * stride;
    let total = 0;
    for (let col = 1; col <= angularSteps; col++) {
      total += armBoost(r, (col - 0.5) * 2 * Math.PI / angularSteps);
      table[offset + col] = total;
    }
    for (let col = 1; col <= angularSteps; col++) table[offset + col] /= total;
  }
  return (radiusPc, unit) => {
    const u = Math.max(0, Math.min(1, unit));
    if (radiusPc <= 500 || radiusPc >= SPIRAL_LIMITS.radiusMaxPc) return u * 2 * Math.PI;
    const row = radiusPc / SPIRAL_LIMITS.radiusMaxPc * radialSteps;
    const offset = Math.floor(row) * stride, fraction = row % 1;
    const at = (col: number): number => table[offset + col] + (table[offset + stride + col] - table[offset + col]) * fraction;
    let lo = 0, hi = angularSteps;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (at(mid) < u) lo = mid;
      else hi = mid;
    }
    return (lo + (u - at(lo)) / (at(hi) - at(lo))) * 2 * Math.PI / angularSteps;
  };
}
