import { deriveSeed, mix64 } from '../../core/rng/hash';
import { galaxySeed } from './galaxySeed';

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
    Number(mix64(seed ^ deriveSeed(galaxySeed(), 'orientation', channel)) & 0xfffffn) / 0xfffff;

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

/**
 * A scene frame with the given galactic direction standing up the
 * scene's +Y. Used at the galactic centre, where there is no system to
 * inherit a sky angle from and the hole's own spin axis is the natural
 * reference: it puts the accretion flow in the scene's horizontal
 * plane, which is also the plane the orbit camera turns in.
 * Row-major galactic→scene, like sceneFromGalaxy.
 */
export function sceneFromUpAxis(axis: [number, number, number]): Float32Array {
  const length = Math.hypot(...axis) || 1;
  const n: [number, number, number] = [axis[0] / length, axis[1] / length, axis[2] / length];
  const seed: [number, number, number] = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const cross = (
    a: [number, number, number],
    b: [number, number, number],
  ): [number, number, number] => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const e1raw = cross(seed, n);
  const e1len = Math.hypot(...e1raw);
  const e1: [number, number, number] = [e1raw[0] / e1len, e1raw[1] / e1len, e1raw[2] / e1len];
  const e2 = cross(n, e1);
  // Rows [e2, n, e1] send e2→x̂, n→ŷ, e1→ẑ, and e2 × n = e1 keeps it
  // right-handed — a rotation, not a reflection.
  return new Float32Array([e2[0], e2[1], e2[2], n[0], n[1], n[2], e1[0], e1[1], e1[2]]);
}
