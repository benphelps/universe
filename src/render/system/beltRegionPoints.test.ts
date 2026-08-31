import { describe, expect, it } from 'vitest';
import { AU, G, SOLAR_MASS } from '../../core/physics/constants';
import { elementsToState } from '../../core/math/kepler';
import { mu as muOf, seconds } from '../../core/physics/units';
import type { Asteroid } from '../../universe/smallbody/types';
import {
  createBeltRegionPoints,
  finishBeltRegionPoints,
  updateBeltRegionPointFrame,
  writeBeltRegionPoint,
} from './beltRegionPoints';
import { Quaternion, ShaderMaterial, Vector3 } from 'three';

const ASTEROID: Asteroid = {
  elements: {
    semiMajorAxis: 2.4 * AU,
    eccentricity: 0.18,
    inclination: 0.12,
    longitudeOfAscendingNode: 0.8,
    argumentOfPeriapsis: 1.7,
    meanAnomalyAtEpoch: 0.4,
    epoch: 0,
  },
  diameterKm: 24,
  taxonomy: 'C',
  albedo: 0.08,
  spinPeriodHours: 8,
  tumbling: false,
  rubblePile: true,
  shape: { elongation: 0.8, flattening: 0.7, contactBinary: false, noiseSeedHex: '1234' },
};

describe('belt region GPU points', () => {
  it('stores rebased Kepler elements and updates only shared frame state', () => {
    const points = createBeltRegionPoints(3.08e13, 8e7);
    const mu = muOf(G * SOLAR_MASS);
    expect(writeBeltRegionPoint(points, 0, ASTEROID, mu, 20, 3e-12, true, true)).toBe(1);
    finishBeltRegionPoints(points, 1);
    expect(points.geometry.drawRange.count).toBe(1);
    expect(
      points.geometry.getAttribute('aOrbit0').getX(0) / ((2.4 * AU) / 1000),
    ).toBeCloseTo(1, 6);
    expect(points.geometry.getAttribute('aOrbit1').getZ(0)).toBeGreaterThan(0);
    expect(points.geometry.getAttribute('aFlags').getX(0)).toBe(1);

    const frame = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7);
    const focus = new Vector3(10, 20, 30);
    const host = new Vector3(40, 50, 60);
    updateBeltRegionPointFrame(points, 2.5, focus, host, frame, [0.2, 0.3, 0.4]);
    const material = points.material as ShaderMaterial;
    expect(material.uniforms.uElapsedDays.value).toBe(2.5);
    expect(material.uniforms.uHostOffsetKm.value).toEqual(host);
    expect(points.quaternion.angleTo(frame)).toBeCloseTo(0);
    expect(points.position).toEqual(focus.clone().negate().applyQuaternion(frame));
    expect(material.vertexShader).toContain('for (int i = 0; i < 5; i++)');

    const orbit0 = points.geometry.getAttribute('aOrbit0');
    const orbit1 = points.geometry.getAttribute('aOrbit1');
    for (const elapsedDays of [0, 2.5, 100]) {
      const e = orbit0.getY(0);
      const meanAnomaly = orbit1.getY(0) + orbit1.getZ(0) * elapsedDays;
      let eccentricAnomaly = meanAnomaly;
      for (let i = 0; i < 5; i++) {
        eccentricAnomaly -=
          (eccentricAnomaly - e * Math.sin(eccentricAnomaly) - meanAnomaly) /
          (1 - e * Math.cos(eccentricAnomaly));
      }
      const a = orbit0.getX(0);
      const xPerifocal = a * (Math.cos(eccentricAnomaly) - e);
      const yPerifocal = a * Math.sqrt(1 - e * e) * Math.sin(eccentricAnomaly);
      const cosW = Math.cos(orbit1.getX(0));
      const sinW = Math.sin(orbit1.getX(0));
      const x1 = cosW * xPerifocal - sinW * yPerifocal;
      const y1 = sinW * xPerifocal + cosW * yPerifocal;
      const cosI = Math.cos(orbit0.getZ(0));
      const sinI = Math.sin(orbit0.getZ(0));
      const cosO = Math.cos(orbit0.getW(0));
      const sinO = Math.sin(orbit0.getW(0));
      const gpu = new Vector3(
        cosO * x1 - sinO * cosI * y1,
        sinI * y1,
        -(sinO * x1 + cosO * cosI * y1),
      );
      const state = elementsToState(
        ASTEROID.elements,
        mu,
        seconds((20 + elapsedDays) * 86_400),
      ).position;
      const cpu = new Vector3(state.x, state.z, -state.y).divideScalar(1000);
      // Float attributes retain sub-100 km agreement across a multi-AU
      // orbit; resolved rocks and picking keep the CPU double path.
      expect(gpu.distanceTo(cpu)).toBeLessThan(100);
    }

    points.geometry.dispose();
    material.dispose();
  });
});
