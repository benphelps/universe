import { deriveSeed, mix64 } from '../../core/rng/hash';
import type { GalacticPosition } from './density';

/** The single shared universe every seed lives in. */
export const UNIVERSE_SEED = 0x53494d5f554e4956n;

const VIEWPOINT_SALTS = [0, 1, 2].map((channel) =>
  deriveSeed(UNIVERSE_SEED, 'viewpoint', channel),
);

/**
 * Deterministic locale for an arbitrary star seed: anywhere in the
 * inhabited disk — any galactocentric radius in the stellar belt, any
 * azimuth, settled toward the midplane. Band brightness, bulge
 * prominence, rift patterns, and the population mix all follow from
 * where the system actually sits.
 */
export function viewpointForSeed(seed: bigint): GalacticPosition {
  const unit = (channel: number): number =>
    Number(mix64(seed ^ VIEWPOINT_SALTS[channel]) & 0xfffffn) / 0xfffff;
  const radius = 5200 + 6800 * unit(0);
  const azimuth = unit(1) * 2 * Math.PI;
  const settled = unit(2) * 2 - 1;
  return {
    xPc: radius * Math.cos(azimuth),
    yPc: radius * Math.sin(azimuth),
    zPc: settled * Math.abs(settled) * 350 + 15,
  };
}
