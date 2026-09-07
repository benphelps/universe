import { expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { bodyFrameQuaternion, toBodyFrame } from '../../universe/planet/illumination';
import type { PlanetRotation } from '../../universe/planet/types';
const year = 365.25 * 86400;
const rotation: PlanetRotation = { periodHours: 24, obliquityRad: 0, locked: false, spinOrbitResonance: null };

it('matches the rendered inverse spin/tilt frame, including retrograde and epoch', () => {
  for (const tilt of [0, 0.4, Math.PI / 2, 2.8, Math.PI]) for (const t of [0, 12345, year * 1.7]) {
    const r = { ...rotation, obliquityRad: tilt };
    const local = new Vector3(0.3, 0.5, -0.8).normalize();
    // Distant body orientation: tilted group, spinning mesh. Its inverse
    // must put the same world direction back on the same terrain texel.
    const world = local.clone().applyAxisAngle(new Vector3(0, 1, 0), 2 * Math.PI * t / 86400)
      .applyAxisAngle(new Vector3(0, 0, 1), -tilt);
    const back = toBodyFrame(world, r, t);
    expect(local.distanceTo(new Vector3(back.x, back.y, back.z))).toBeLessThan(1e-12);
    expect(world.applyQuaternion(new Quaternion(...bodyFrameQuaternion(r, t))).distanceTo(local)).toBeLessThan(1e-12);
  }
});
