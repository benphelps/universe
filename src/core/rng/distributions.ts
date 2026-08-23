import type { Rng } from './rng';

export function logNormal(rng: Rng, mu: number, sigma: number): number {
  return Math.exp(rng.normal(mu, sigma));
}

export function rayleigh(rng: Rng, sigma: number): number {
  let u = 1 - rng.float();
  if (u <= 0) u = Number.MIN_VALUE;
  return sigma * Math.sqrt(-2 * Math.log(u));
}

export function exponential(rng: Rng, rate: number): number {
  let u = 1 - rng.float();
  if (u <= 0) u = Number.MIN_VALUE;
  return -Math.log(u) / rate;
}

/** Sample p(x) ∝ x^-alpha on [min, max] by inverse CDF. */
export function powerLaw(rng: Rng, alpha: number, min: number, max: number): number {
  const u = rng.float();
  if (Math.abs(alpha - 1) < 1e-9) {
    return min * Math.exp(u * Math.log(max / min));
  }
  const p = 1 - alpha;
  const a = min ** p;
  const b = max ** p;
  return (a + u * (b - a)) ** (1 / p);
}

export interface PowerLawSegment {
  min: number;
  max: number;
  alpha: number;
}

/** Analytic integral of c·x^-alpha over [min, max]. */
function segmentIntegral(c: number, alpha: number, min: number, max: number): number {
  if (Math.abs(alpha - 1) < 1e-9) return c * Math.log(max / min);
  const p = 1 - alpha;
  return (c * (max ** p - min ** p)) / p;
}

/**
 * Broken power law, continuous across segment boundaries
 * (each segment's coefficient chosen to match the previous at its junction).
 */
export function brokenPowerLaw(rng: Rng, segments: PowerLawSegment[]): number {
  const coeffs: number[] = [1];
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const boundary = segments[i].min;
    coeffs.push(coeffs[i - 1] * boundary ** (segments[i].alpha - prev.alpha));
  }
  const weights = segments.map((s, i) => segmentIntegral(coeffs[i], s.alpha, s.min, s.max));
  const seg = segments[weightedIndex(rng, weights)];
  return powerLaw(rng, seg.alpha, seg.min, seg.max);
}

/** Poisson-distributed count: Knuth for small rates, normal approximation above. */
export function poisson(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    return Math.max(0, Math.round(rng.normal(lambda, Math.sqrt(lambda))));
  }
  const threshold = Math.exp(-lambda);
  let count = 0;
  let product = rng.float();
  while (product > threshold) {
    count++;
    product *= rng.float();
  }
  return count;
}

/** Index drawn with probability proportional to its weight. */
export function weightedIndex(rng: Rng, weights: number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let target = rng.float() * total;
  for (let i = 0; i < weights.length; i++) {
    target -= weights[i];
    if (target <= 0) return i;
  }
  return weights.length - 1;
}
