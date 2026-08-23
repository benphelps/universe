import type { Vec3 } from './vec3';
import { meanAnomalyAt, type OrbitalElements } from './orbit';

export interface StateVectors {
  position: Vec3;
  velocity: Vec3;
}

/**
 * Eccentric anomaly from mean anomaly (elliptic case), Newton–Raphson.
 * Converges to ~1e-12 in a handful of iterations for e < 0.99.
 */
export function solveEccentricAnomaly(meanAnomaly: number, e: number): number {
  const M = meanAnomaly;
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 32; i++) {
    const f = E - e * Math.sin(E) - M;
    const fPrime = 1 - e * Math.cos(E);
    const delta = f / fPrime;
    E -= delta;
    if (Math.abs(delta) < 1e-13) break;
  }
  return E;
}

export function trueAnomalyFromEccentric(E: number, e: number): number {
  return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
}

/**
 * Position and velocity at time t for elements around a body with
 * gravitational parameter mu = G(M+m). Closed-form: exact for any t.
 */
export function elementsToState(el: OrbitalElements, mu: number, t: number): StateVectors {
  const { semiMajorAxis: a, eccentricity: e } = el;
  const E = solveEccentricAnomaly(meanAnomalyAt(el, mu, t), e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const r = a * (1 - e * cosE);
  const rootOneMinusE2 = Math.sqrt(1 - e * e);

  // Perifocal frame: x toward periapsis, z along orbit normal.
  const xP = a * (cosE - e);
  const yP = a * rootOneMinusE2 * sinE;
  const vFactor = Math.sqrt(mu * a) / r;
  const vxP = -vFactor * sinE;
  const vyP = vFactor * rootOneMinusE2 * cosE;

  return {
    position: perifocalToReference(xP, yP, el),
    velocity: perifocalToReference(vxP, vyP, el),
  };
}

/** Rotation Rz(Ω)·Rx(i)·Rz(ω) applied to a perifocal-plane vector. */
function perifocalToReference(xP: number, yP: number, el: OrbitalElements): Vec3 {
  const cosO = Math.cos(el.longitudeOfAscendingNode);
  const sinO = Math.sin(el.longitudeOfAscendingNode);
  const cosI = Math.cos(el.inclination);
  const sinI = Math.sin(el.inclination);
  const cosW = Math.cos(el.argumentOfPeriapsis);
  const sinW = Math.sin(el.argumentOfPeriapsis);

  const x1 = cosW * xP - sinW * yP;
  const y1 = sinW * xP + cosW * yP;
  const y2 = cosI * y1;
  const z2 = sinI * y1;

  return {
    x: cosO * x1 - sinO * y2,
    y: sinO * x1 + cosO * y2,
    z: z2,
  };
}
