import type { Vec3 } from '../../core/math/vec3';
import { faceUvToDir } from './cubeSphere';

/**
 * A global cell grid on the cube sphere: 6·n² cells addressed by id
 * (face·n² + row·n + col). Powers the drainage model's flow routing and
 * the per-direction river lookups — dir→cell is O(1), and adjacency
 * works across face seams by stepping in uv space and re-projecting
 * (faceUvToDir extends past the face boundary; normalizing lands the
 * direction in the neighboring face's own coordinates).
 */
export interface CubeGrid {
  n: number;
  cellCount: number;
  /** Angular size of one cell edge, radians. */
  cellAngularRad: number;
  /** Unit cell-center directions, packed xyz — hot paths index this
   *  directly instead of allocating through centerOf. */
  centers: Float64Array;
  cellOfDir(dir: Vec3): number;
  centerOf(cell: number): Vec3;
  /** The 8 surrounding cells (edge + corner); corners of the cube have
   *  duplicates, deduplicated to -1 padding. */
  neighborsOf(cell: number): Int32Array;
}

export function createCubeGrid(n: number): CubeGrid {
  const cellCount = 6 * n * n;
  const centers = new Float64Array(cellCount * 3);
  for (let cell = 0; cell < cellCount; cell++) {
    const face = Math.floor(cell / (n * n));
    const rem = cell % (n * n);
    const j = Math.floor(rem / n);
    const i = rem % n;
    const dir = faceUvToDir(face, (i + 0.5) / n, (j + 0.5) / n);
    centers[cell * 3] = dir.x;
    centers[cell * 3 + 1] = dir.y;
    centers[cell * 3 + 2] = dir.z;
  }

  const cellOfDir = (dir: Vec3): number => {
    const ax = Math.abs(dir.x);
    const ay = Math.abs(dir.y);
    const az = Math.abs(dir.z);
    let face: number;
    let s: number;
    let t: number;
    if (ax >= ay && ax >= az) {
      if (dir.x > 0) { face = 0; s = -dir.z / ax; t = dir.y / ax; }
      else { face = 1; s = dir.z / ax; t = dir.y / ax; }
    } else if (ay >= az) {
      if (dir.y > 0) { face = 2; s = dir.x / ay; t = -dir.z / ay; }
      else { face = 3; s = dir.x / ay; t = dir.z / ay; }
    } else {
      if (dir.z > 0) { face = 4; s = dir.x / az; t = dir.y / az; }
      else { face = 5; s = -dir.x / az; t = dir.y / az; }
    }
    const i = Math.min(n - 1, Math.max(0, Math.floor(((s + 1) / 2) * n)));
    const j = Math.min(n - 1, Math.max(0, Math.floor(((t + 1) / 2) * n)));
    return face * n * n + j * n + i;
  };

  // Adjacency across seams by uv overstep: normalize the overhanging
  // direction and ask which cell owns it.
  const neighbors = new Int32Array(cellCount * 8).fill(-1);
  const offsets = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];
  for (let cell = 0; cell < cellCount; cell++) {
    const face = Math.floor(cell / (n * n));
    const rem = cell % (n * n);
    const j = Math.floor(rem / n);
    const i = rem % n;
    let count = 0;
    for (const [di, dj] of offsets) {
      const dir = faceUvToDir(face, (i + di + 0.5) / n, (j + dj + 0.5) / n);
      const neighbor = cellOfDir(dir);
      if (neighbor === cell) continue;
      let seen = false;
      for (let k = 0; k < count; k++) {
        if (neighbors[cell * 8 + k] === neighbor) { seen = true; break; }
      }
      if (!seen) neighbors[cell * 8 + count++] = neighbor;
    }
  }

  return {
    n,
    cellCount,
    cellAngularRad: Math.PI / 2 / n,
    centers,
    cellOfDir,
    centerOf: (cell) => ({
      x: centers[cell * 3],
      y: centers[cell * 3 + 1],
      z: centers[cell * 3 + 2],
    }),
    neighborsOf: (cell) => neighbors.subarray(cell * 8, cell * 8 + 8),
  };
}
