import { describe, expect, it } from 'vitest';
import { C_LIGHT, SIGMA_SB } from './constants';
import {
  accretionRate,
  clampSpin,
  discPeakRadiusRg,
  discTemperature,
  eddingtonLuminosity,
  gravitationalRadius,
  horizonRadiusRg,
  iscoRadiusRg,
  MAX_SPIN,
  orbitalBeta,
  photonSphereRadiusRg,
  radiativeEfficiency,
  shadowImpactParameterRg,
} from './blackHole';

describe('Kerr geometry', () => {
  it('reproduces the textbook static-hole radii', () => {
    expect(horizonRadiusRg(0)).toBeCloseTo(2, 12);
    expect(photonSphereRadiusRg(0)).toBeCloseTo(3, 10);
    expect(iscoRadiusRg(0)).toBeCloseTo(6, 10);
    expect(shadowImpactParameterRg()).toBeCloseTo(5.19615, 4);
    // Circular-orbit speed at the ISCO is exactly half light speed.
    expect(orbitalBeta(6)).toBeCloseTo(0.5, 12);
    // η = 1 − √(8/9).
    expect(radiativeEfficiency(0)).toBeCloseTo(1 - Math.sqrt(8 / 9), 10);
  });

  it('tracks spin through the Bardeen–Press–Teukolsky branches', () => {
    // Extremal Kerr is unreachable — spin saturates at the Thorne
    // limit, a hair short of horizon, photon orbit and ISCO all
    // meeting at r_g.
    expect(clampSpin(1)).toBe(MAX_SPIN);
    expect(horizonRadiusRg(1)).toBeCloseTo(1.063, 3);
    expect(photonSphereRadiusRg(1)).toBeCloseTo(1.074, 3);
    expect(iscoRadiusRg(1)).toBeCloseTo(1.2372, 3);
    expect(radiativeEfficiency(1)).toBeCloseTo(0.321, 2);
    // Retrograde: the disc is pushed out to 9 r_g and the photon
    // orbit to 4 r_g, and the engine loses most of its efficiency.
    expect(iscoRadiusRg(-1)).toBeCloseTo(9, 1);
    expect(photonSphereRadiusRg(-1)).toBeCloseTo(4, 1);
    expect(radiativeEfficiency(-1)).toBeCloseTo(0.038, 2);
    // Efficiency rises monotonically with prograde spin.
    for (let a = -0.9; a < 0.9; a += 0.1) {
      expect(radiativeEfficiency(a + 0.1)).toBeGreaterThan(radiativeEfficiency(a));
    }
  });

  it('scales lengths linearly with mass', () => {
    // 2.95 km per solar mass is the classroom Schwarzschild radius.
    expect(2 * gravitationalRadius(1)).toBeCloseTo(2954, 0);
    expect(gravitationalRadius(4e6) / gravitationalRadius(1)).toBeCloseTo(4e6, 0);
  });
});

describe('accretion', () => {
  it('anchors the Eddington luminosity', () => {
    // 1.26e31 W per solar mass, the standard value.
    expect(eddingtonLuminosity(1) / 1.26e31).toBeCloseTo(1, 1);
    expect(eddingtonLuminosity(4.3e6) / (4.3e6 * eddingtonLuminosity(1))).toBeCloseTo(1, 9);
  });

  it('inverts luminosity back to a rest-mass budget', () => {
    const efficiency = radiativeEfficiency(0);
    const rate = accretionRate(1e38, efficiency);
    expect(rate * efficiency * C_LIGHT * C_LIGHT).toBeCloseTo(1e38, 5);
  });

  it('gives a Shakura–Sunyaev profile with a torque-free inner edge', () => {
    const mass = 4.3e6;
    const inner = iscoRadiusRg(0.5);
    const rate = accretionRate(0.1 * eddingtonLuminosity(mass), radiativeEfficiency(0.5));
    const t = (r: number) => discTemperature(r, inner, mass, rate);

    // Zero at the edge, peaking at (49/36) r_in, then r^(−3/4).
    expect(t(inner)).toBe(0);
    const peak = discPeakRadiusRg(inner);
    expect(t(peak)).toBeGreaterThan(t(peak * 1.3));
    expect(t(peak)).toBeGreaterThan(t(peak * 0.8));
    expect(t(4000) / t(1000)).toBeCloseTo(4 ** -0.75, 2);

    // A supermassive disc is a soft-UV emitter, not an X-ray one.
    expect(t(peak)).toBeGreaterThan(3e4);
    expect(t(peak)).toBeLessThan(3e5);

    // The radiated flux integrates back to the accretion luminosity:
    // ∫ 2·σT⁴ 2πr dr over the disc recovers η·Ṁc² to within the
    // fraction that falls outside the sampled span.
    const rg = gravitationalRadius(mass);
    let flux = 0;
    const steps = 20000;
    for (let i = 0; i < steps; i++) {
      const r0 = inner * (1e7 / inner) ** (i / steps);
      const r1 = inner * (1e7 / inner) ** ((i + 1) / steps);
      const rm = Math.sqrt(r0 * r1);
      flux += 2 * SIGMA_SB * t(rm) ** 4 * 2 * Math.PI * (rm * rg) * (r1 - r0) * rg;
    }
    // Newtonian dissipation releases 3/2 of the ISCO binding energy
    // over an infinite disc, so the closed-form total is GMṀ/2r_in.
    expect(flux / ((6.6743e-11 * mass * 1.98892e30 * rate) / (2 * inner * rg))).toBeCloseTo(1, 2);
  });
});
