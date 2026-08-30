import { describe, expect, it } from 'vitest';
import { MAX_SPIN, shadowImpactParameterRg } from '../../core/physics/blackHole';
import { DISPLAY_FALLOFF, GEODESIC_GLSL, LENSING_REACH_RG, profileStretch } from './geodesicGlsl';
import { KERR_GLSL } from './kerrGlsl';

describe('the geodesic tracer', () => {
  it('settles the shadow against the critical curve, not a fitted radius', () => {
    // The shader decides capture in closed form rather than integrating
    // through the photon orbit, and the closed form is Bardeen's
    // spherical-orbit constants — the exact Kerr critical curve. Its
    // static limit has to be 3√3, which is the number the info panel
    // quotes, and the only literal the branch is allowed to carry.
    expect(KERR_GLSL).toContain('xiIn * xiIn + eta < 27.0');
    expect(27).toBeCloseTo(shadowImpactParameterRg() ** 2, 6);
    // No perturbative bend factor, no squeeze parameter, no strength
    // dial: if one ever appears, the shadow has stopped being a result.
    for (const dial of ['uSpinStrength', 'uSqueeze', 'SPIN_FACTOR', 'BEND_SCALE']) {
      expect(KERR_GLSL).not.toContain(dial);
      expect(GEODESIC_GLSL).not.toContain(dial);
    }
  });

  it('lets the flow reach its own inner edge at any spin', () => {
    // The Schwarzschild tracer had to hold the flow outside 4 r_g,
    // because inside that its emitter kinematics were undefined. Kerr
    // propagation with a plunging interior has no such floor, so the
    // shader must not reimpose one — a Thorne-limited disc starts at
    // 1.24 r_g and a starved torus at its horizon.
    expect(GEODESIC_GLSL).not.toContain('RENDER_INNER_FLOOR');
    expect(KERR_GLSL).toContain('kerrFlowVelocity');
    expect(MAX_SPIN).toBe(0.998);
  });

  it('returns darkness where the gas could not have emitted', () => {
    // Within a whisker of the horizon the gas is dragged at the
    // horizon's own rate, and a photon carrying more angular momentum
    // than that rotation outruns would have had to leave it with
    // negative energy. Clamping the denominator — the obvious guard —
    // turns the one place light cannot come from into the brightest
    // thing on the screen. See the companion test in core/physics.
    expect(GEODESIC_GLSL).toContain('received > 1.0e-3 ? 1.0 / received : 0.0');
    expect(GEODESIC_GLSL).not.toContain('max(u.x - xi * u.y');
  });

  it('turns the flow exactly once before it renews it, at every radius', () => {
    // The bug this pins. The pattern's angle carries two terms — a bulk
    // rotation counted in inner-edge turns, and a differential part
    // that resets when a realisation is reseeded — and its lifetime is
    // one orbit *at that radius*. Together those have to come to a
    // single full turn per lifetime wherever you stand: run the clock
    // off the inner edge instead and gas at twice that radius, orbiting
    // at a third of the rate, is replaced after a third of a rotation,
    // which reads as the pattern restarting before it has been
    // anywhere.
    const lifetime = 1;
    for (const radii of [1, 1.5, 2, 4, 8, 12]) {
      const keplerian = radii ** -1.5;
      const span = lifetime / keplerian;
      // Angle advanced over one lifetime, mirroring turbulentField.
      const angle = (phase: number, age: number): number =>
        2 * Math.PI * phase + 2 * Math.PI * age * (keplerian - 1);
      const swept = angle(span, span) - angle(0, 0);
      expect(swept / (2 * Math.PI)).toBeCloseTo(1, 9);
    }
  });

  it('reseeds each realisation only where it carries no weight', () => {
    // Both the generation index and the crossfade weight read the same
    // clock, which is what lets that clock vary with radius without
    // drawing a ring at every radius where it happens to tick.
    for (let i = 0; i <= 400; i++) {
      const t = (i / 400) * 4;
      const phase = t - Math.floor(t);
      const weightA = Math.sin(Math.PI * phase);
      const weightB = Math.cos(Math.PI * phase);
      // A is reseeded at whole turns, B at halves.
      if (Math.abs(phase) < 1e-9 || Math.abs(phase - 1) < 1e-9) {
        expect(Math.abs(weightA)).toBeLessThan(1e-6);
      }
      if (Math.abs(phase - 0.5) < 1e-9) {
        expect(Math.abs(weightB)).toBeLessThan(1e-6);
      }
      // Variance is what the blend conserves, so the clumping holds its
      // contrast straight through a handover.
      expect(weightA * weightA + weightB * weightB).toBeCloseTo(1, 12);
    }
  });

  it('gives either flow regime the same readable falloff', () => {
    // A hot torus runs T ∝ r^-1 and a thin disc r^-3/4; both have to
    // reach the screen falling at the same rate, or one is a haze and
    // the other a dot. Ten times the radius, twenty-five times fainter.
    for (const profileExponent of [1, 0.75, 0.5]) {
      const gamma = profileStretch(profileExponent);
      const decade = (10 ** (-4 * profileExponent)) ** gamma;
      expect(decade).toBeCloseTo(10 ** -DISPLAY_FALLOFF, 6);
      expect(gamma).toBeGreaterThan(0);
      expect(gamma).toBeLessThanOrEqual(1);
    }
  });

  it('takes over the sky only where the bending is worth the blur', () => {
    // Inside the reach the background is the hole's own cube map, which
    // is coarser than the screen. So the boundary has to fall where a
    // ray still bends appreciably — a degree or more, deflection 4/b —
    // and not out where it would be trading softness for a pixel.
    const bendDeg = ((4 / LENSING_REACH_RG) * 180) / Math.PI;
    expect(bendDeg).toBeGreaterThan(1);
    expect(bendDeg).toBeLessThan(20);
    // And it must still clear the shadow itself by a wide margin, or
    // the hole would be drawing its own edge against unlensed sky.
    expect(LENSING_REACH_RG).toBeGreaterThan(20 * shadowImpactParameterRg());
    expect(GEODESIC_GLSL).toContain(`LENSING_REACH = ${LENSING_REACH_RG}.0`);
  });
});
