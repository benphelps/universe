import type { Camera, Object3D, Vector3 } from 'three';

const tests = new WeakMap<Object3D, (camera: Camera) => boolean>();
let enabled = true;
export function setSkyVolumeCulling(value: boolean): void { enabled = value; }
export function registerSkyVolume(object: Object3D, test: (camera: Camera) => boolean): void { tests.set(object, test); }
export function skyVolumeVisible(object: Object3D, camera: Camera): boolean {
  return !enabled || (tests.get(object)?.(camera) ?? true);
}

/** A box's enclosing sphere gives a conservative angular bound. */
export function sphereInViewCone(delta: Vector3, radius: number, forward: Vector3, viewRadius: number): boolean {
  const distance = delta.length();
  if (distance <= radius) return true;
  const reach = viewRadius + Math.asin(Math.min(1, radius / distance)) + 1e-5;
  return reach >= Math.PI || delta.dot(forward) >= Math.cos(reach) * distance;
}
