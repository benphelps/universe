import type { Asteroid, AsteroidShape, AsteroidTaxonomy } from './types';

type Rgb = [number, number, number];
const TAXONOMY_TINT: Record<AsteroidTaxonomy, Rgb> = {
  S: [0.4, 0.34, 0.27], C: [0.16, 0.152, 0.145],
  M: [0.4, 0.4, 0.43], D: [0.2, 0.16, 0.13],
};

/** Diffuse-sphere approximation: geometric albedo p = 2/3 reflectance.
 * Preserve taxonomy chroma while the generated albedo owns brightness. */
export function asteroidSurfaceColor(asteroid: Pick<Asteroid, 'taxonomy' | 'albedo'>): Rgb {
  const tint = TAXONOMY_TINT[asteroid.taxonomy];
  const luma = .2126 * tint[0] + .7152 * tint[1] + .0722 * tint[2];
  const scale = Math.max(0, Math.min(1.5 * asteroid.albedo / luma, 1 / Math.max(...tint)));
  return tint.map(value => value * scale) as Rgb;
}

/** Volume-preserving datum axes, in units of mean radius; Y is the pole. */
export function asteroidAxes(shape: AsteroidShape): [number, number, number] {
  const ba = Math.max(.45, shape.elongation), ca = Math.max(.45, shape.flattening);
  const major = 1 / Math.cbrt(ba * ca);
  return [major, ca * major, ba * major];
}
