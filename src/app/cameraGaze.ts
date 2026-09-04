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
 * down at its anchor with the pole up the screen — the orbit's own
 * view, and the one an arrival is given. Descending tips that resting gaze from nadir up to the
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

/** The heading a view carries: the way its screen-up points on the
 *  ground, measured from north. Read when the head takes over from
 *  the orbit, so the view it arrives with is the view it keeps. */
export function headingOf(up: Vector3, pole: Vector3, screenUp: Vector3): number {
  const { north, east } = tangentFrame(up, pole);
  return Math.atan2(screenUp.dot(east), screenUp.dot(north));
}
