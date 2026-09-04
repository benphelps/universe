import { Matrix4, Quaternion, Vector3 } from 'three';

/** Where a scale's pole stands against the screen. */
export interface PoleOnScreen {
  /** Angle from screen-up to the pole's projection, radians, positive clockwise. */
  rollRad: number;
  /** How much of the pole lies in the screen plane: 1 flat, 0 end-on. */
  extent: number;
  /** The pole's component along the view: positive leans away from the eye. */
  toward: number;
}

/** Below this much of the pole in the screen plane, no roll helps. */
export const END_ON_EXTENT = 0.02;

function axes(q: Quaternion): { forward: Vector3; up: Vector3; right: Vector3 } {
  return {
    forward: new Vector3(0, 0, -1).applyQuaternion(q),
    up: new Vector3(0, 1, 0).applyQuaternion(q),
    right: new Vector3(1, 0, 0).applyQuaternion(q),
  };
}

export function poleOnScreen(q: Quaternion, pole: Vector3): PoleOnScreen {
  const { forward, up, right } = axes(q);
  const toward = pole.dot(forward);
  const flat = pole.clone().addScaledVector(forward, -toward);
  const extent = flat.length();
  const rollRad = extent < 1e-6 ? 0 : Math.atan2(flat.dot(right), flat.dot(up));
  return { rollRad, extent, toward };
}

/**
 * The orientation with the pole rolled up the screen: a turn about the
 * view axis and nothing else, so the anchor stays where it was in the
 * frame. Null when the pole points at or away from the eye, where no
 * roll would help.
 */
export function rolledToPole(q: Quaternion, pole: Vector3): Quaternion | null {
  const { rollRad, extent } = poleOnScreen(q, pole);
  if (extent < END_ON_EXTENT) return null;
  const forward = new Vector3(0, 0, -1).applyQuaternion(q);
  return new Quaternion().setFromAxisAngle(forward, rollRad).multiply(q).normalize();
}

/** An orientation looking along `back` toward the anchor, with `upHint`
 *  up the screen as nearly as the view allows. */
export function lookingFrom(q: Quaternion, back: Vector3, upHint: Vector3): Quaternion {
  const b = back.clone().normalize();
  let up = upHint.clone().addScaledVector(b, -upHint.dot(b));
  if (up.lengthSq() < 1e-6) {
    const current = new Vector3(0, 1, 0).applyQuaternion(q);
    up = current.addScaledVector(b, -current.dot(b));
  }
  up.normalize();
  const right = new Vector3().crossVectors(up, b);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, b)).normalize();
}

/** Looking down the pole from its north side, screen-up kept as it was. */
export function faceOn(q: Quaternion, pole: Vector3): Quaternion {
  return lookingFrom(q, pole, new Vector3(0, 1, 0).applyQuaternion(q));
}

/** Looking along the pole's plane from the nearest point on it, pole up. */
export function edgeOn(q: Quaternion, pole: Vector3): Quaternion {
  const forward = new Vector3(0, 0, -1).applyQuaternion(q);
  const flat = forward.clone().addScaledVector(pole, -forward.dot(pole));
  if (flat.lengthSq() < 1e-6) {
    const seed = Math.abs(pole.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
    flat.crossVectors(seed, pole);
  }
  return lookingFrom(q, flat.negate(), pole);
}

/**
 * Turn a camera bodily about an axis through the origin: the points
 * it carries (its position, the anchor it orbits) and the orientations
 * it holds (its own, and any it is easing toward). Turned by the same
 * angle the scene's frame turns, the camera keeps to whatever that
 * frame turns against.
 */
export function turnAbout(axis: Vector3, rad: number, points: Vector3[], quaternions: Quaternion[]): void {
  const turn = new Quaternion().setFromAxisAngle(axis, rad);
  for (const point of points) point.applyQuaternion(turn);
  for (const q of quaternions) q.premultiply(turn);
}

/** Ease-in-out over the unit interval. */
export function easeInOut(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
