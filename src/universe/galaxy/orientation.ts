import { deriveSeed, mix64 } from '../../core/rng/hash';
import { UNIVERSE_SEED } from './sectors';

/**
 * A system's orbital plane bears no relation to the galactic disk, so
 * each seed gets a uniformly random orientation of its scene frame
 * within the galaxy: the Milky Way band crosses every sky at its own
 * angle, with the galactic center wherever the geometry puts it.
 * Returns a row-major 3×3 rotation taking galactic vectors to scene
 * vectors (galactic z is the disk normal).
 */
export function sceneFromGalaxy(seed: bigint): Float32Array {
  const unit = (channel: number): number =>
    Number(mix64(seed ^ deriveSeed(UNIVERSE_SEED, 'orientation', channel)) & 0xfffffn) / 0xfffff;

  // Uniform random rotation via the subgroup-algorithm quaternion.
  const u1 = unit(0);
  const u2 = unit(1) * 2 * Math.PI;
  const u3 = unit(2) * 2 * Math.PI;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  const qx = a * Math.sin(u2);
  const qy = a * Math.cos(u2);
  const qz = b * Math.sin(u3);
  const qw = b * Math.cos(u3);

  const xx = qx * qx;
  const yy = qy * qy;
  const zz = qz * qz;
  const xy = qx * qy;
  const xz = qx * qz;
  const yz = qy * qz;
  const wx = qw * qx;
  const wy = qw * qy;
  const wz = qw * qz;
  return new Float32Array([
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ]);
}

/** Apply the row-major rotation to a galactic-frame vector. */
export function rotateToScene(
  m: Float32Array,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}
