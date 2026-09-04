import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { edgeOn, faceOn, poleOnScreen, rolledToPole } from './reorient';

const Y = new Vector3(0, 1, 0);

function axes(q: Quaternion): { forward: Vector3; up: Vector3; right: Vector3 } {
  return {
    forward: new Vector3(0, 0, -1).applyQuaternion(q),
    up: new Vector3(0, 1, 0).applyQuaternion(q),
    right: new Vector3(1, 0, 0).applyQuaternion(q),
  };
}

/** A camera at `position` looking at the origin, rolled by `rollRad`. */
function camera(position: Vector3, rollRad = 0): Quaternion {
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(position, new Vector3(), Y));
  const forward = new Vector3(0, 0, -1).applyQuaternion(q);
  return new Quaternion().setFromAxisAngle(forward, rollRad).multiply(q).normalize();
}

describe('poleOnScreen', () => {
  it('reads a roll back off a rolled view', () => {
    const q = camera(new Vector3(2, 1, 4), 0.7);
    const seen = poleOnScreen(q, Y);
    expect(Math.abs(seen.rollRad)).toBeCloseTo(0.7, 6);
    expect(seen.extent).toBeGreaterThan(0.9);
  });

  it('sees the pole end-on from above it', () => {
    const q = camera(new Vector3(0, 5, 0));
    expect(poleOnScreen(q, Y).extent).toBeLessThan(1e-3);
    expect(poleOnScreen(q, Y).toward).toBeCloseTo(-1, 6);
  });
});

describe('rolledToPole', () => {
  it('rolls the pole up the screen and leaves the view direction alone', () => {
    const q = camera(new Vector3(2, 1, 4), -1.9);
    const rolled = rolledToPole(q, Y);
    expect(rolled).not.toBeNull();
    const before = axes(q);
    const after = axes(rolled!);
    expect(after.forward.dot(before.forward)).toBeCloseTo(1, 9);
    expect(poleOnScreen(rolled!, Y).rollRad).toBeCloseTo(0, 9);
    expect(after.up.dot(Y)).toBeGreaterThan(0);
  });

  it('does nothing when already up, and declines end-on', () => {
    const q = camera(new Vector3(2, 1, 4));
    expect(rolledToPole(q, Y)!.dot(q)).toBeCloseTo(1, 9);
    expect(rolledToPole(camera(new Vector3(0, 5, 0)), Y)).toBeNull();
  });
});

describe('faceOn', () => {
  it('looks down the pole from its north side and keeps screen-up where it can', () => {
    const q = camera(new Vector3(2, 1, 4), 0.4);
    const face = faceOn(q, Y);
    const { forward, up } = axes(face);
    expect(forward.dot(Y)).toBeCloseTo(-1, 9);
    const before = axes(q).up.clone().addScaledVector(Y, -axes(q).up.y).normalize();
    expect(up.dot(before)).toBeCloseTo(1, 6);
  });
});

describe('edgeOn', () => {
  it('looks along the plane with the pole up, from the nearest side', () => {
    const q = camera(new Vector3(2, 3, 4));
    const edge = edgeOn(q, Y);
    const { forward, up } = axes(edge);
    expect(forward.dot(Y)).toBeCloseTo(0, 9);
    expect(up.dot(Y)).toBeCloseTo(1, 9);
    const heading = axes(q).forward.clone().setY(0).normalize();
    expect(forward.dot(heading)).toBeCloseTo(1, 9);
  });
});
