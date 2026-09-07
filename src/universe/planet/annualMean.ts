import { seasonalPointCycle, type SeasonalCycle } from './seasonalClimate';
import { annualMeanAtAngle, interpolateAnnualMean, type AnnualMeanField } from './annualMeanField';
export { annualMeanTemperatureAt, annualMeanFieldBytes, type AnnualMeanField } from './annualMeanField';
export type AnnualMeanResult = { status: 'ready'; field: AnnualMeanField }
  | { status: 'unavailable'; reason: 'spin-resolved' | 'resolution-budget' | 'not-converged' };

/** Worker-only preparation. Quarter/midpoint refinement tests the complete
 * temperature lookup, including the radiative reference. It is a measured
 * interpolation criterion, not a rigorous continuum bound. No partial
 * recipe escapes on failure. Fixed albedo, opacity and phases are inherited
 * from the dry cycle; this does not close the ice-albedo/water feedback.
 * Variable resolved maps failed the cost gate and are explicitly deferred. */
export function buildAnnualMeanField(cycle: SeasonalCycle,
  options: { toleranceK?: number; maxPointSolves?: number } = {}): AnnualMeanResult {
  const toleranceK = options.toleranceK ?? 0.2, budget = options.maxPointSolves ?? 513;
  if (!(toleranceK > 0) || !Number.isFinite(toleranceK) || !Number.isInteger(budget) || budget < 1 || budget > 4097) throw new RangeError('Invalid annual mean resolution budget');
  if (cycle.mode !== 'rotation-averaged') return { status: 'unavailable', reason: 'spin-resolved' };
  const samples = new Map<number, { ratio: number; fourth: number; mean: number }>();
  let failure: 'resolution-budget' | 'not-converged' | null = null, maximumProbeErrorK = 0;
  // Dyadic integer coordinates keep all repeated endpoints identical.
  const full = 16384, nodes = new Set<number>([0, full]);
  const point = (lat: number) => {
    const cached = samples.get(lat); if (cached) return cached;
    if (samples.size >= budget) { failure = 'resolution-budget'; return { ratio: 1, fourth: 0, mean: 0 }; }
    const angle = lat * Math.PI / full;
    const profile = seasonalPointCycle(cycle, { x: Math.sin(angle), y: Math.cos(angle), z: 0 });
    if (!profile) { failure = 'not-converged'; return { ratio: 1, fourth: 0, mean: 0 }; }
    let mean = 0, fourth = 0;
    for (const t of profile.temperatureK) { mean += t / profile.temperatureK.length; fourth += t ** 4 / profile.temperatureK.length; }
    const radiativeK = Math.sqrt(Math.sqrt(fourth));
    const value = { ratio: radiativeK > 0 ? Math.min(1, mean / radiativeK) : 1, fourth, mean };
    samples.set(lat, value); return value;
  };
  const refine = (a: number, b: number) => {
    if (failure) return;
    const av = point(a), bv = point(b); let error = 0;
    for (const f of [0.25, 0.5, 0.75]) {
      const p = point(a + (b - a) * f);
      error = Math.max(error, Math.abs(p.mean - interpolateAnnualMean(av.ratio, bv.ratio, av.fourth, bv.fourth, f)));
    }
    if (error > toleranceK) {
      if (b - a <= 1) { failure = 'resolution-budget'; return; }
      const mid = (a + b) / 2; nodes.add(mid); refine(a, mid); refine(mid, b);
    } else maximumProbeErrorK = Math.max(maximumProbeErrorK, error);
  };
  for (let a = 0; a < full; a += full / 8) { nodes.add(a); nodes.add(a + full / 8); refine(a, a + full / 8); }
  if (failure) return { status: 'unavailable', reason: failure };
  const coordinates = [...nodes].sort((a, b) => a - b);
  const field: AnnualMeanField = {
    angles: Float64Array.from(coordinates, a => a * Math.PI / full),
    ratios: Float64Array.from(coordinates, a => point(a).ratio),
    fourthK4: Float64Array.from(coordinates, a => point(a).fourth),
    meanK: 0, minimumK: Infinity, maximumK: 0, iceFraction: 0,
    diagnostics: { pointSolves: samples.size, maximumProbeErrorK, toleranceK },
  };
  // Area-weighted diagnostics of this completed lookup. Midpoint angular
  // cells use exact spherical band areas; poles contribute zero area.
  const n = 512;
  for (let k = 0; k <= n; k++) {
    const angle = k * Math.PI / n, t = annualMeanAtAngle(field, angle);
    field.minimumK = Math.min(field.minimumK, t); field.maximumK = Math.max(field.maximumK, t);
    if (k === n) continue;
    const mean = annualMeanAtAngle(field, angle + Math.PI / (2 * n));
    const weight = (Math.cos(angle) - Math.cos(angle + Math.PI / n)) / 2;
    field.meanK += weight * mean;
    field.iceFraction += weight * Math.max(0, Math.min(1, (268 - mean) / 10));
  }
  return { status: 'ready', field };
}
