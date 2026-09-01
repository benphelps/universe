import { Rng } from '../rng/rng';
import { GRAD3, type NoiseSampler3 } from './simplex3';

/**
 * Seeded 3D gradient noise on a periodic lattice: f(x, y, z) repeats
 * exactly every `period` lattice cells on every axis. This is what a
 * texture sampled with repeat wrapping needs — a field that actually
 * tiles — which the simplex stream cannot provide. Classic Perlin
 * construction with a quintic fade, scaled to match the simplex
 * noise's spread so a consumer can swap one for the other without
 * moving its thresholds; the peaks land near ±1.4 rather than ±1.
 */
export function createPeriodicPerlin3(seed: bigint, period: number): NoiseSampler3 {
  if (period < 1 || period > 256 || !Number.isInteger(period)) {
    throw new Error(`period must be an integer in [1, 256], got ${period}`);
  }
  const rng = new Rng(seed);
  const perm = new Uint8Array(512);
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) table[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = table[i];
    table[i] = table[j];
    table[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = table[i & 255];

  const wrap = (v: number): number => ((v % period) + period) % period;
  const grad = (ix: number, iy: number, iz: number): readonly [number, number, number] =>
    GRAD3[perm[wrap(ix) + perm[wrap(iy) + perm[wrap(iz)]]] % 12];
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

  return (x, y, z) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;
    const corner = (cx: number, cy: number, cz: number): number => {
      const g = grad(ix + cx, iy + cy, iz + cz);
      return g[0] * (fx - cx) + g[1] * (fy - cy) + g[2] * (fz - cz);
    };
    const u = fade(fx);
    const v = fade(fy);
    const w = fade(fz);
    const x00 = lerp(corner(0, 0, 0), corner(1, 0, 0), u);
    const x10 = lerp(corner(0, 1, 0), corner(1, 1, 0), u);
    const x01 = lerp(corner(0, 0, 1), corner(1, 0, 1), u);
    const x11 = lerp(corner(0, 1, 1), corner(1, 1, 1), u);
    return PERLIN_SCALE * lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
  };
}

/** Matches the spread of createSimplex3 (std ≈ 0.43), measured over
 *  both streams; raw Perlin runs narrower. Peaks reach ≈ ±1.42. */
const PERLIN_SCALE = 1.568;
