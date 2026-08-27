import { deriveSeed, mix64 } from '../../core/rng/hash';
import { galaxySeed } from './galaxySeed';
import type { GalacticPosition } from './density';

let viewpointSalts: bigint[] | null = null;

/**
 * Deterministic locale for an arbitrary star seed: anywhere in the
 * inhabited disk — any galactocentric radius in the stellar belt, any
 * azimuth, settled toward the midplane. Band brightness, bulge
 * prominence, rift patterns, and the population mix all follow from
 * where the system actually sits.
 */
export function viewpointForSeed(seed: bigint): GalacticPosition {
  viewpointSalts ??= [0, 1, 2].map((channel) => deriveSeed(galaxySeed(), 'viewpoint', channel));
  const salts = viewpointSalts;
  const unit = (channel: number): number =>
    Number(mix64(seed ^ salts[channel]) & 0xfffffn) / 0xfffff;
  const radius = 5200 + 6800 * unit(0);
  const azimuth = unit(1) * 2 * Math.PI;
  const settled = unit(2) * 2 - 1;
  return {
    xPc: radius * Math.cos(azimuth),
    yPc: radius * Math.sin(azimuth),
    zPc: settled * Math.abs(settled) * 350 + 15,
  };
}
