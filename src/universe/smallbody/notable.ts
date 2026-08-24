import { deriveSeed, seedFromHex } from '../../core/rng/hash';
import type { StarSystem } from '../system/types';
import { instantiateBeltCell } from './asteroids';
import type { Asteroid } from './types';

/**
 * Each belt's biggest bodies — its Ceres and Vesta analogs: everything
 * above ~150 km from the deterministic top of the size distribution.
 * These are a navigation window into the belt's population, not a
 * modeling distinction: any member can materialize identically from
 * its cell.
 */
export function notableAsteroids(system: StarSystem): Asteroid[] {
  const out: Asteroid[] = [];
  system.belts.forEach((belt, i) => {
    const beltSeed = deriveSeed(seedFromHex(system.seedHex), 'notable', i);
    const sample = instantiateBeltCell(beltSeed, belt, 0, 24, 90);
    sample.sort((a, b) => b.diameterKm - a.diameterKm);
    const large = sample.filter((asteroid) => asteroid.diameterKm >= 150).slice(0, 8);
    out.push(...(large.length > 0 ? large : sample.slice(0, 1)));
  });
  return out;
}

/** Short designation for a notable asteroid, from its shape seed. */
export function asteroidDesignation(asteroid: Asteroid): string {
  return `A-${asteroid.shape.noiseSeedHex.slice(-4).toUpperCase()}`;
}
