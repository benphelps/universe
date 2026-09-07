import { seedFromHex } from '../../core/rng/hash';
import type { StarSystem } from '../system/types';
import { beltCatalogue, beltPopulationSeed, NOTABLE_DIAMETER_KM } from './beltRegion';
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
    const beltSeed = beltPopulationSeed(seedFromHex(system.seedHex), i);
    out.push(...beltCatalogue(beltSeed,belt,8,NOTABLE_DIAMETER_KM));
  });
  return out;
}

/** Short designation for a notable asteroid, from its shape seed. */
export function asteroidDesignation(asteroid: Asteroid): string {
  return `A-${asteroid.shape.noiseSeedHex.slice(-4).toUpperCase()}`;
}
