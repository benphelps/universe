import { deriveSeed, seedFromHex } from '../../core/rng/hash';
import type { StarSystem } from '../system/types';
import { instantiateBeltCell } from './asteroids';
import type { Asteroid } from './types';

/**
 * The landmark rocks of a system: the largest members of each belt,
 * deterministically instantiated, offered as focusable bodies alongside
 * the planets.
 */
export function notableAsteroids(system: StarSystem): Asteroid[] {
  const out: Asteroid[] = [];
  system.belts.forEach((belt, i) => {
    const beltSeed = deriveSeed(seedFromHex(system.seedHex), 'notable', i);
    const sample = instantiateBeltCell(beltSeed, belt, 0, 14, 25);
    sample.sort((a, b) => b.diameterKm - a.diameterKm);
    out.push(...sample.slice(0, 2));
  });
  return out;
}

/** Short designation for a notable asteroid, from its shape seed. */
export function asteroidDesignation(asteroid: Asteroid): string {
  return `A-${asteroid.shape.noiseSeedHex.slice(-4).toUpperCase()}`;
}
