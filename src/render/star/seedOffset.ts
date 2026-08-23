import { seedFromHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import type { Star } from '../../universe/star/types';

/**
 * Seed-stable noise-domain offset shared by the star's surface and corona
 * shaders, so all of a star's fields are unique to it and mutually registered.
 */
export function seedOffset(star: Star): [number, number, number] {
  const rng = new Rng(seedFromHex(star.seedHex)).fork('surface-offset');
  return [rng.range(0, 100), rng.range(0, 100), rng.range(0, 100)];
}
