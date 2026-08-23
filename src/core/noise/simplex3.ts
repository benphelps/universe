import { Rng } from '../rng/rng';

export type NoiseSampler3 = (x: number, y: number, z: number) => number;

const GRAD3: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

const F3 = 1 / 3;
const G3 = 1 / 6;

/**
 * Seeded 3D simplex noise (Gustavson's formulation), output in [-1, 1].
 * The permutation table is a Fisher–Yates shuffle from the seed's stream,
 * so identical seeds sample identically anywhere (main thread or worker).
 */
export function createSimplex3(seed: bigint): NoiseSampler3 {
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

  return (x, y, z) => {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);

    let i1: number, j1: number, k1: number;
    let i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    let n = 0;
    n += corner(x0, y0, z0, perm[ii + perm[jj + perm[kk]]] % 12);
    n += corner(x1, y1, z1, perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] % 12);
    n += corner(x2, y2, z2, perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] % 12);
    n += corner(x3, y3, z3, perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] % 12);
    return 32 * n;
  };
}

function corner(x: number, y: number, z: number, gi: number): number {
  let t = 0.6 - x * x - y * y - z * z;
  if (t < 0) return 0;
  t *= t;
  const g = GRAD3[gi];
  return t * t * (g[0] * x + g[1] * y + g[2] * z);
}
