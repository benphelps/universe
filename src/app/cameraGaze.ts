import { Matrix4, Quaternion, Vector3 } from 'three';

/** Where the camera looks, given where it stands. */
export interface Gaze {
  /** Unit direction from the orbit anchor to the camera. */
  up: Vector3;
  /** The turntable's polar axis: what "north" means at this scale. */
  pole: Vector3;
  /** The head's turn from north, radians, positive toward east. */
  headingRad: number;
  /** The head's tilt above the resting gaze, radians. */
  pitchRad: number;
  /** 1 with the feet on the ground, 0 in orbit. */
  surface: number;
}

/** The tangent frame the head turns in: north toward the pole, east
 *  to its right. Within a degree of the pole itself, where north has
 *  no meaning, the frame is pinned to a fixed axis so a heading still
 *  names one direction. */
export function tangentFrame(up: Vector3, pole: Vector3): { north: Vector3; east: Vector3 } {
  let north = pole.clone().addScaledVector(up, -pole.dot(up));
  if (north.lengthSq() < 1e-4) {
    const ref = Math.abs(up.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
    north = ref.addScaledVector(up, -ref.dot(up));
  }
  north.normalize();
  return { north, east: new Vector3().crossVectors(north, up) };
}

/**
 * One gaze for every altitude. In orbit the camera looks straight
 * down at its anchor with the pole up the screen — the turntable's
 * own view. Descending tips that resting gaze from nadir up to the
 * horizon, and the head's own pitch comes in with the tip, so the
 * gaze is exactly nadir at the top of the band and exactly where the
 * head aimed it at the floor. The heading rides the whole way: what
 * the head faced is what lies up the screen at nadir. The tip is a
 * pure pitch about the camera's right axis — nothing here ever rolls
 * the view to meet a compass, so the only way it turns is by the
 * hand turning it.
 */
export function gazeQuaternion(gaze: Gaze, out = new Quaternion()): Quaternion {
  const { up, headingRad, pitchRad } = gaze;
  const surface = Math.min(1, Math.max(0, gaze.surface));
  const t = surface * surface * (3 - 2 * surface);
  const heading = headingVector(up, gaze.pole, headingRad);
  const restPitch = -(Math.PI / 2) * (1 - t);
  const pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, restPitch + pitchRad * t));
  const forward = heading
    .clone()
    .multiplyScalar(Math.cos(pitch))
    .addScaledVector(up, Math.sin(pitch));
  const screenUp = up
    .clone()
    .multiplyScalar(Math.cos(pitch))
    .addScaledVector(heading, -Math.sin(pitch));
  const right = new Vector3().crossVectors(forward, screenUp);
  return out.setFromRotationMatrix(
    new Matrix4().makeBasis(right, screenUp, forward.clone().negate()),
  );
}

/** The way the head faces on the ground: the gaze's horizontal part. */
export function headingVector(up: Vector3, pole: Vector3, headingRad: number): Vector3 {
  const { north, east } = tangentFrame(up, pole);
  return north.multiplyScalar(Math.cos(headingRad)).addScaledVector(east, Math.sin(headingRad));
}

/** The heading that faces the same way measured from another pole,
 *  so swapping the pole under it leaves the view exactly where it is. */
export function rebasedHeading(
  up: Vector3,
  pole: Vector3,
  headingRad: number,
  newPole: Vector3,
): number {
  const facing = headingVector(up, pole, headingRad);
  const { north, east } = tangentFrame(up, newPole);
  return Math.atan2(facing.dot(east), facing.dot(north));
}

/**
 * The pole turned about the local vertical to stand behind the
 * heading: the same tilt out of the ground, facing the way the head
 * does. A camera climbing out of the surface takes this as its
 * turntable axis, so whatever it faced down there is up from then on
 * and a heading of zero names that view.
 */
export function alignedPole(up: Vector3, pole: Vector3, headingRad: number): Vector3 {
  const radial = pole.dot(up);
  const tangent = Math.sqrt(Math.max(0, 1 - radial * radial));
  return up
    .clone()
    .multiplyScalar(radial)
    .addScaledVector(headingVector(up, pole, headingRad), tangent)
    .normalize();
}
