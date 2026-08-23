import type { Vec3 } from '../../core/math/vec3';

/**
 * Cube-sphere addressing: six faces, each parameterized by (u, v) ∈ [0,1]².
 * Face order: +X, −X, +Y, −Y, +Z, −Z. Chunks and crater cells address
 * through this; the height field itself samples 3D noise by direction,
 * so mapping distortion only affects tile sizes.
 */
export function faceUvToDir(face: number, u: number, v: number): Vec3 {
  const s = 2 * u - 1;
  const t = 2 * v - 1;
  let x: number;
  let y: number;
  let z: number;
  switch (face) {
    case 0: x = 1; y = t; z = -s; break;
    case 1: x = -1; y = t; z = s; break;
    case 2: x = s; y = 1; z = -t; break;
    case 3: x = s; y = -1; z = t; break;
    case 4: x = s; y = t; z = 1; break;
    default: x = -s; y = t; z = -1; break;
  }
  const inv = 1 / Math.hypot(x, y, z);
  return { x: x * inv, y: y * inv, z: z * inv };
}

/** Angular size of one chunk edge at a given quadtree level, radians (~face arc / 2^level). */
export function chunkAngularSize(level: number): number {
  return (Math.PI / 2) / 2 ** level;
}
