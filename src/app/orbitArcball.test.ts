import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { OrbitArcball } from './orbitArcball';

/** A camera at `position` looking at the origin with +Y up the screen. */
function arcball(position: Vector3, target = new Vector3()): { camera: Object3D; orbit: OrbitArcball } {
  const camera = new Object3D();
  camera.position.copy(position);
  camera.quaternion.setFromRotationMatrix(new Matrix4().lookAt(position, target, new Vector3(0, 1, 0)));
  const element = {
    clientHeight: 1000,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLElement;
  const orbit = new OrbitArcball(camera, element);
  orbit.target.copy(target);
  orbit.easeSeconds = 0;
  return { camera, orbit };
}

function axes(q: Quaternion): { forward: Vector3; up: Vector3; right: Vector3 } {
  return {
    forward: new Vector3(0, 0, -1).applyQuaternion(q),
    up: new Vector3(0, 1, 0).applyQuaternion(q),
    right: new Vector3(1, 0, 0).applyQuaternion(q),
  };
}

describe('OrbitArcball', () => {
  it('a drag to the right takes the camera to the left, so the scene goes right', () => {
    const { camera, orbit } = arcball(new Vector3(0, 0, 10));
    orbit.turnBy(250, 0);
    orbit.update(1);
    // A quarter screen at speed 1 is a quarter turn: +Z goes to -X.
    expect(camera.position.x).toBeCloseTo(-10, 6);
    expect(camera.position.z).toBeCloseTo(0, 6);
    expect(camera.position.length()).toBeCloseTo(10, 9);
  });

  it('a drag down takes the camera up over the scene', () => {
    const { camera, orbit } = arcball(new Vector3(0, 0, 10));
    orbit.turnBy(0, 250);
    orbit.update(1);
    expect(camera.position.y).toBeCloseTo(10, 6);
    expect(camera.position.z).toBeCloseTo(0, 6);
  });

  it('keeps the target in the middle of the frame through any turn', () => {
    const { camera, orbit } = arcball(new Vector3(3, 4, 5));
    for (const [dx, dy] of [
      [120, -40],
      [-300, 210],
      [15, 900],
    ]) {
      orbit.turnBy(dx, dy);
      orbit.update(1);
      const toTarget = camera.position.clone().negate().normalize();
      expect(axes(camera.quaternion).forward.dot(toTarget)).toBeCloseTo(1, 9);
    }
  });

  it('has no pole: a drag straight over the top keeps going', () => {
    const { camera, orbit } = arcball(new Vector3(0, 0, 10));
    orbit.turnBy(0, 500);
    orbit.update(1);
    // Half a turn: the camera is on the far side, upside down, still aimed home.
    expect(camera.position.z).toBeCloseTo(-10, 6);
    expect(axes(camera.quaternion).up.y).toBeCloseTo(-1, 6);
    orbit.turnBy(0, 500);
    orbit.update(1);
    expect(camera.position.z).toBeCloseTo(10, 6);
    expect(axes(camera.quaternion).up.y).toBeCloseTo(1, 6);
  });

  it('turns in the screen frame however the camera is rolled', () => {
    const { camera, orbit } = arcball(new Vector3(0, 0, 10));
    // Roll the view a third of a turn about its own axis.
    camera.quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 2.1));
    const before = axes(camera.quaternion);
    orbit.turnBy(3, 0);
    orbit.update(1);
    const moved = camera.position.clone().sub(new Vector3(0, 0, 10)).normalize();
    expect(moved.dot(before.right)).toBeCloseTo(-1, 4);
  });

  it('orbits the target, not the origin', () => {
    const target = new Vector3(5, 0, 0);
    const { camera, orbit } = arcball(new Vector3(5, 0, 10), target);
    orbit.turnBy(250, 0);
    orbit.update(1);
    expect(camera.position.x).toBeCloseTo(-5, 6);
    expect(camera.position.z).toBeCloseTo(0, 6);
  });

  it('glides for the same time whatever the frame rate', () => {
    const slow = arcball(new Vector3(0, 0, 10));
    const fast = arcball(new Vector3(0, 0, 10));
    for (const { orbit } of [slow, fast]) {
      orbit.easeSeconds = 0.2;
      orbit.turnBy(100, 0);
    }
    for (let i = 0; i < 6; i++) slow.orbit.update(0.05);
    for (let i = 0; i < 30; i++) fast.orbit.update(0.01);
    expect(slow.camera.position.x).toBeCloseTo(fast.camera.position.x, 6);
    expect(Math.abs(slow.camera.position.x)).toBeLessThan(10 * Math.sin(2 * Math.PI * 0.1));
  });

  it('follows a drag while disabled without turning', () => {
    const { camera, orbit } = arcball(new Vector3(0, 0, 10));
    orbit.enabled = false;
    orbit.turnBy(300, 300);
    orbit.update(1);
    expect(camera.position.toArray()).toEqual([0, 0, 10]);
  });
});
