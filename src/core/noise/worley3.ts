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
 *
 * A cell's feature point is a property of the cell, so it is worked out
 * once and kept. Every sample looks at the twenty-seven cells around it
 * and the neighbourhoods of nearby samples are almost entirely the same
 * cells, so without this the lattice is rebuilt from scratch for every
 * point asked about: a terrain chunk was running ninety-nine thousand
 * BigInt hashes to learn a hundred and eight numbers, and the whole
 * planet's plate field only ever has a couple of hundred cells in it.
 * The table is bounded by how much lattice the caller actually visits,
 * which for a field sampled over the unit sphere is that couple of
 * hundred.
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

  // Offset within the cell on each axis, then the cell's identity — the
  // same four channels the hash is asked for, in the same order.
  const cells = new Map<number, Float64Array>();
  const cellOf = (cx: number, cy: number, cz: number): Float64Array => {
    // The hash sees each axis masked to sixteen bits, so the key does
    // too: cells that share a hash share an entry, as they must.
    const key = ((cx & 0xffff) * 0x10000 + (cy & 0xffff)) * 0x10000 + (cz & 0xffff);
    let cell = cells.get(key);
    if (cell === undefined) {
      cell = new Float64Array(4);
      for (let channel = 0; channel < 4; channel++) cell[channel] = hashToUnit(cx, cy, cz, channel);
      cells.set(key, cell);
    }
    return cell;
  };

  return (x, y, z) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    let f1 = Infinity;
    let f2 = Infinity;
    let id1 = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cx = ix + dx;
          const cy = iy + dy;
          const cz = iz + dz;
          const cell = cellOf(cx, cy, cz);
          const d = Math.hypot(cx + cell[0] - x, cy + cell[1] - y, cz + cell[2] - z);
          if (d < f1) {
            f2 = f1;
            f1 = d;
            id1 = cell[3];
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
    }
    return { f1, f2, id1 };
  };
}
