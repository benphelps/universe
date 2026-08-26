import { mix64 } from '../rng/hash';

export interface WorleySample {
  /** Distance to the nearest feature point. */
  f1: number;
  /** Distance to the second-nearest feature point. */
  f2: number;
  /** Stable unit-interval identity of the nearest cell — constant across
   *  a cell's whole region, discontinuous exactly at the ridges. */
  id1: number;
}

/**
 * Seeded 3D Worley (cellular) noise. Feature points sit one per lattice
 * cell; f2−f1 approaches zero on the ridges between cells — the basis
 * for plate-boundary masks. Distances are in units of the cell size.
 */
export function createWorley3(seed: bigint): (x: number, y: number, z: number) => WorleySample {
  const hashToUnit = (cx: number, cy: number, cz: number, channel: number): number => {
    const h = mix64(
      seed ^
        ((BigInt(cx & 0xffff) << 40n) |
          (BigInt(cy & 0xffff) << 24n) |
          (BigInt(cz & 0xffff) << 8n) |
          BigInt(channel)),
    );
    return Number(h & 0xfffffn) / 0xfffff;
  };

  return (x, y, z) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    let f1 = Infinity;
    let f2 = Infinity;
    let bx = 0;
    let by = 0;
    let bz = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cx = ix + dx;
          const cy = iy + dy;
          const cz = iz + dz;
          const px = cx + hashToUnit(cx, cy, cz, 0);
          const py = cy + hashToUnit(cx, cy, cz, 1);
          const pz = cz + hashToUnit(cx, cy, cz, 2);
          const d = Math.hypot(px - x, py - y, pz - z);
          if (d < f1) {
            f2 = f1;
            f1 = d;
            bx = cx;
            by = cy;
            bz = cz;
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
    }
    return { f1, f2, id1: hashToUnit(bx, by, bz, 3) };
  };
}
