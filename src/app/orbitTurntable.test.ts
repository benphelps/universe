import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { OrbitTurntable } from './orbitTurntable';

function turntable(position: Vector3): { camera: Object3D; orbit: OrbitTurntable } {
  const camera = new Object3D();
  camera.position.copy(position);
  const element = {
    clientHeight: 1000,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLElement;
  const orbit = new OrbitTurntable(camera, element);
  orbit.easeSeconds = 0;
  return { camera, orbit };
}

describe('OrbitTurntable', () => {
  it('a drag to the right swings the camera clockwise about the axis, seen from its pole', () => {
    const { camera, orbit } = turntable(new Vector3(0, 0, 10));
    orbit.turnBy(250, 0);
    orbit.update(1);
    // A quarter screen at speed 1 is a quarter turn: +Z goes to -X.
    expect(camera.position.x).toBeCloseTo(-10, 6);
    expect(camera.position.z).toBeCloseTo(0, 6);
    expect(camera.position.length()).toBeCloseTo(10, 9);
  });

  it('a drag down climbs toward the pole and stops short of it', () => {
    const { camera, orbit } = turntable(new Vector3(0, 0, 10));
    orbit.turnBy(0, 200);
    orbit.update(1);
    expect(camera.position.y).toBeGreaterThan(9);
    orbit.turnBy(0, 1000);
    orbit.update(1);
    expect(camera.position.y).toBeLessThan(10);
    expect(camera.position.y).toBeGreaterThan(10 * Math.cos(1e-3));
    expect(camera.position.length()).toBeCloseTo(10, 9);
  });

  it('swings about whatever axis it is given', () => {
    const { camera, orbit } = turntable(new Vector3(0, 0, 10));
    orbit.axis.set(1, 0, 0);
    orbit.turnBy(250, 0);
    orbit.update(1);
    expect(camera.position.x).toBeCloseTo(0, 6);
    expect(Math.abs(camera.position.y)).toBeCloseTo(10, 6);
  });

  it('changing the axis moves nothing by itself', () => {
    const { camera, orbit } = turntable(new Vector3(3, 4, 5));
    orbit.axis.set(0.6, 0, 0.8);
    orbit.update(1);
    expect(camera.position.toArray()).toEqual([3, 4, 5]);
  });

  it('orbits the target, not the origin', () => {
    const { camera, orbit } = turntable(new Vector3(5, 0, 10));
    orbit.target.set(5, 0, 0);
    orbit.turnBy(250, 0);
    orbit.update(1);
    expect(camera.position.x).toBeCloseTo(-5, 6);
    expect(camera.position.z).toBeCloseTo(0, 6);
  });

  it('glides for the same time whatever the frame rate', () => {
    const slow = turntable(new Vector3(0, 0, 10));
    const fast = turntable(new Vector3(0, 0, 10));
    for (const { orbit } of [slow, fast]) {
      orbit.easeSeconds = 0.2;
      orbit.turnBy(100, 0);
    }
    for (let i = 0; i < 6; i++) slow.orbit.update(0.05);
    for (let i = 0; i < 30; i++) fast.orbit.update(0.01);
    expect(slow.camera.position.x).toBeCloseTo(fast.camera.position.x, 6);
    // Neither has finished: 0.3 s is a fraction of the way through the glide.
    expect(Math.abs(slow.camera.position.x)).toBeLessThan(10 * Math.sin(2 * Math.PI * 0.1));
  });

  it('follows a drag while disabled without turning', () => {
    const { camera, orbit } = turntable(new Vector3(0, 0, 10));
    orbit.enabled = false;
    orbit.turnBy(300, 300);
    orbit.update(1);
    expect(camera.position.toArray()).toEqual([0, 0, 10]);
  });
});
