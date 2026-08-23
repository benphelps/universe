import { deriveSeed, seedFromHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { powerLaw } from '../../core/rng/distributions';
import type { Star, StellarPhysical, Variability } from './types';

/**
 * Pulsational variability from position on the HR diagram:
 * instability-strip crossers pulse (Cepheids, RR Lyrae), luminous AGB
 * stars are long-period Mira variables.
 */
export function classifyVariability(
  rng: Rng,
  phys: StellarPhysical,
  feH: number,
): Variability | null {
  if (phys.stage === 'agb' && phys.luminosity > 2000) {
    return { type: 'mira', periodDays: rng.range(150, 500), amplitude: rng.range(0.4, 0.8) };
  }
  const inStrip = phys.tEff > 4800 && phys.tEff < 7500;
  if (!inStrip) return null;
  if (phys.stage === 'horizontal-branch' && feH < -0.8) {
    return { type: 'rr-lyrae', periodDays: rng.range(0.3, 0.9), amplitude: rng.range(0.15, 0.35) };
  }
  if ((phys.stage === 'giant' || phys.stage === 'supergiant') && phys.luminosity > 300) {
    // Period–luminosity relation, solar-calibrated to classical Cepheids.
    const periodDays = 3 * (phys.luminosity / 300) ** 0.87;
    return { type: 'cepheid', periodDays, amplitude: rng.range(0.1, 0.25) };
  }
  return null;
}

const FLARE_BUCKET_DAYS = 0.5;
const FLARE_DECAY_DAYS = 0.02;

/**
 * Total flare luminosity boost (fractional) at time t. Flares are a
 * deterministic Poisson schedule: each half-day bucket independently seeds
 * its own events, so any t evaluates O(1) with no history.
 */
export function flareBoostAt(star: Star, tDays: number): number {
  const rate = star.activity.flareRatePerDay;
  if (rate <= 0) return 0;
  const seed = deriveSeed(seedFromHex(star.seedHex), 'flares');
  const bucket = Math.floor(tDays / FLARE_BUCKET_DAYS);
  let boost = 0;
  for (const b of [bucket - 1, bucket]) {
    const rng = new Rng(deriveSeed(seed, 'bucket', b));
    if (rng.float() >= rate * FLARE_BUCKET_DAYS) continue;
    const start = (b + rng.float()) * FLARE_BUCKET_DAYS;
    if (tDays < start) continue;
    const amplitude = powerLaw(rng, 1.8, 0.05, 1.5);
    boost += amplitude * Math.exp(-(tDays - start) / FLARE_DECAY_DAYS);
  }
  return boost;
}

/** Combined luminosity multiplier at time t: pulsation × flaring. */
export function luminosityMultiplierAt(star: Star, tDays: number): number {
  let multiplier = 1;
  if (star.variability) {
    const { periodDays, amplitude } = star.variability;
    multiplier *= 1 + amplitude * Math.sin((2 * Math.PI * tDays) / periodDays);
  }
  return multiplier * (1 + flareBoostAt(star, tDays));
}
