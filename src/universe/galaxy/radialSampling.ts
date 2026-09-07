/** Inverse radial CDF of an axisymmetric surface density Σ(R).
 * An annulus contains 2π R Σ(R) dR; omitting R overpopulates the
 * centre even when the input surface profile is perfectly smooth. */
export function surfaceRadiusSampler(
  surfaceDensity: (radius: number) => number,
  maxRadius: number,
  steps = 1024,
): (unit: number) => number {
  const h = maxRadius / steps;
  const cumulative = new Float64Array(steps + 1);
  const ring = (r: number): number => r * surfaceDensity(r);
  for (let i = 1; i <= steps; i++) {
    cumulative[i] = cumulative[i - 1] + h / 6 *
      (ring((i - 1) * h) + 4 * ring((i - 0.5) * h) + ring(i * h));
  }
  const total = cumulative[steps];
  if (!(total > 0) || !Number.isFinite(total)) throw new Error('surface profile has no finite mass');
  return (unit: number): number => {
    const target = Math.max(0, Math.min(1, unit)) * total;
    let lo = 0;
    let hi = steps;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < target) lo = mid;
      else hi = mid;
    }
    const span = cumulative[hi] - cumulative[lo];
    return (lo + (span > 0 ? (target - cumulative[lo]) / span : 0)) * h;
  };
}
