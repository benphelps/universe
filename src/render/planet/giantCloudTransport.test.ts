import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { upperCloudAirmass } from './giantCloudTransport';

it('uses the ray incidence on the elevated cloud sphere, including grazing sunlight', () => {
  const origin = new Vector3(0, 0, 1);
  for (const h of [.0001, .001, .01, .05]) {
    for (const mu of [0, .001, .01, .1, .5, 1]) {
      const direction = new Vector3(Math.sqrt(1 - mu * mu), 0, mu);
      // Independently intersect the ray with the cloud sphere and measure
      // its incidence. In particular the base-deck tangent is NOT tangent
      // to the upper cloud, so its path must remain finite at sunset.
      const distance = -origin.dot(direction) + Math.sqrt(origin.dot(direction) ** 2 + (1 + h) ** 2 - origin.lengthSq());
      const intersection = origin.clone().addScaledVector(direction, distance).normalize();
      expect(upperCloudAirmass(mu, h)).toBeCloseTo(1 / intersection.dot(direction), 8);
    }
    expect(upperCloudAirmass(1, h)).toBeCloseTo(1);
    expect(upperCloudAirmass(0, h)).toBeLessThan(100);
  }
  expect(upperCloudAirmass(0, .01)).toBeLessThan(upperCloudAirmass(0, .001));
});
