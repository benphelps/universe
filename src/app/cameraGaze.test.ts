import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { gazeQuaternion, tangentFrame, wrapAngle } from './cameraGaze';

const Y = new Vector3(0, 1, 0);

function axes(q: Quaternion): { forward: Vector3; screenUp: Vector3; right: Vector3 } {
  return {
    forward: new Vector3(0, 0, -1).applyQuaternion(q),
    screenUp: new Vector3(0, 1, 0).applyQuaternion(q),
    right: new Vector3(1, 0, 0).applyQuaternion(q),
  };
}

/** A camera standing over 30° N, 40° E of the scene's +Z meridian. */
const up = new Vector3(
  Math.cos(0.5236) * Math.sin(0.6981),
  Math.sin(0.5236),
  Math.cos(0.5236) * Math.cos(0.6981),
).normalize();

describe('gazeQuaternion', () => {
  it('in orbit looks down at the anchor with the pole up the screen', () => {
    const q = gazeQuaternion({ up, pole: Y, headingRad: 0, pitchRad: 0, surface: 0 });
    const { forward, screenUp } = axes(q);
    expect(forward.dot(up)).toBeCloseTo(-1, 6);
    const { north } = tangentFrame(up, Y);
    expect(screenUp.dot(north)).toBeCloseTo(1, 6);
  });

  it('matches a look-at with the pole as the up hint', () => {
    const q = gazeQuaternion({ up, pole: Y, headingRad: 0, pitchRad: 0, surface: 0 });
    const position = up.clone().multiplyScalar(3);
    const reference = new Quaternion().setFromRotationMatrix(
      new Matrix4().lookAt(position, new Vector3(), Y),
    );
    expect(Math.abs(q.dot(reference))).toBeCloseTo(1, 6);
  });

  it('on the ground looks along the heading with the zenith up the screen', () => {
    const headingRad = 1.1;
    const q = gazeQuaternion({ up, pole: Y, headingRad, pitchRad: 0, surface: 1 });
    const { forward, screenUp } = axes(q);
    const { north, east } = tangentFrame(up, Y);
    const heading = north.clone().multiplyScalar(Math.cos(headingRad)).addScaledVector(east, Math.sin(headingRad));
    expect(forward.dot(heading)).toBeCloseTo(1, 6);
    expect(screenUp.dot(up)).toBeCloseTo(1, 6);
  });

  it('never rolls: descending is a pure pitch about the camera right axis', () => {
    const headingRad = 2.3;
    let previous: Vector3 | null = null;
    for (let surface = 0; surface <= 1.0001; surface += 0.05) {
      const q = gazeQuaternion({ up, pole: Y, headingRad, pitchRad: 0, surface });
      const { right } = axes(q);
      if (previous) expect(right.dot(previous)).toBeCloseTo(1, 6);
      previous = right;
    }
  });

  it('at nadir carries the heading up the screen rather than a compass', () => {
    const headingRad = -0.8;
    const q = gazeQuaternion({ up, pole: Y, headingRad, pitchRad: 0, surface: 0 });
    const { screenUp } = axes(q);
    const { north, east } = tangentFrame(up, Y);
    const heading = north.clone().multiplyScalar(Math.cos(headingRad)).addScaledVector(east, Math.sin(headingRad));
    expect(screenUp.dot(heading)).toBeCloseTo(1, 6);
  });

  it('keeps the head pitch range half way down', () => {
    const q = gazeQuaternion({ up, pole: Y, headingRad: 0, pitchRad: Math.PI / 2, surface: 0.5 });
    const { forward } = axes(q);
    // Rest pitch is -45°; the head adds +90°: the gaze reaches 45° above the horizon.
    expect(forward.dot(up)).toBeCloseTo(Math.sin(Math.PI / 4), 6);
  });

  it('takes any pole as north', () => {
    const pole = new Vector3(0.3, 0.2, 0.93).normalize();
    const q = gazeQuaternion({ up, pole, headingRad: 0, pitchRad: 0, surface: 0 });
    const { screenUp } = axes(q);
    expect(screenUp.dot(tangentFrame(up, pole).north)).toBeCloseTo(1, 6);
  });
});

describe('tangentFrame', () => {
  it('is a right-handed frame on the sphere', () => {
    const { north, east } = tangentFrame(up, Y);
    expect(north.dot(up)).toBeCloseTo(0, 9);
    expect(east.dot(up)).toBeCloseTo(0, 9);
    expect(new Vector3().crossVectors(east, north).dot(up)).toBeCloseTo(1, 9);
  });

  it('pins a fixed axis at the pole itself', () => {
    const { north } = tangentFrame(Y, Y);
    expect(north.x).toBeCloseTo(1, 9);
  });
});

describe('wrapAngle', () => {
  it('folds into the half-open turn', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(3 * Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 12);
    expect(wrapAngle(-7)).toBeCloseTo(-7 + 2 * Math.PI, 12);
  });
});
