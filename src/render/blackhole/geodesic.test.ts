import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Quaternion } from 'three';
import { describe, expect, it } from 'vitest';

/** The renderer object's own source, for the ordering it has to keep. */
const BLACK_HOLE_SOURCE = readFileSync(
  new URL('./blackHoleObject.ts', import.meta.url),
  'utf8',
);
import {
  MAX_SPIN,
  horizonRadiusRg,
  iscoRadiusRg,
  shadowImpactParameterRg,
} from '../../core/physics/blackHole';
import { flowFourVelocity } from '../../core/physics/kerr';
import {
  FLOW_DRAW_SPAN,
  GEODESIC_GLSL,
  LENSING_REACH_RG,
  drawnFlowRadiusRg,
  framedFlowRadiusRg,
} from './geodesicGlsl';
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

  it('leaves the spin axis empty, as a thick flow does', () => {
    // Vertical support against a body rotating at the local Keplerian
    // rate gives ρ ∝ exp(−cot²θ/2ε²). Near the midplane cot θ → μ and
    // that is the ordinary Gaussian of scale height εR; toward the
    // axis cot θ runs away and the density falls faster than any
    // exponential, which is the funnel — the evacuated channel every
    // simulation of a hot flow shows.
    //
    // Written in μ instead, the same expression leaves a fifth of the
    // midplane density sitting on the axis of a torus half as deep as
    // it is wide. Looking down at one, the eye travels the whole way
    // through that, and what it is looking at is behind it.
    const aspect = 0.55;
    const asShipped = (mu: number): number =>
      Math.exp((-0.5 * (mu / (aspect * Math.sqrt(Math.max(1 - mu * mu, 1e-8)))) ** 2));
    const inMuAlone = (mu: number): number => Math.exp(-0.5 * (mu / aspect) ** 2);
    // On the axis: nothing, against a fifth of the midplane.
    expect(inMuAlone(1)).toBeGreaterThan(0.15);
    expect(asShipped(1)).toBeLessThan(1e-30);
    // Two scale heights up it is already three orders down.
    expect(asShipped(0.9) / inMuAlone(0.9)).toBeLessThan(0.01);
    // And the midplane is untouched — this is the same disc where a
    // disc is what it is.
    for (const mu of [0, 0.05, 0.1]) {
      expect(asShipped(mu) / inMuAlone(mu)).toBeCloseTo(1, 2);
    }
    // Monotonic all the way out, with no shelf for a ray to sit in.
    let previous = 1;
    for (const mu of [0.1, 0.3, 0.5, 0.7, 0.9, 0.99]) {
      const here = asShipped(mu);
      expect(here).toBeLessThan(previous);
      previous = here;
    }
    expect(GEODESIC_GLSL).toContain('mu / (e * sqrt(max(1.0 - mu * mu, 1.0e-8)))');
  });

  it('gives the flow a four-velocity that stays timelike to the horizon', () => {
    // −p·u is the energy a photon has in the frame of whoever is
    // looking, and for any real photon and any real observer it is
    // positive. Everything the renderer does with the shift — the
    // colour, and the beaming as its fourth power — divides by it, so
    // if it can reach zero the picture has a pole in it.
    //
    // It could. kerrFlowVelocity takes the radius where circular
    // orbits stop existing, and it was being handed the flow's inner
    // edge instead. For a cold disc those are the same radius. For a
    // hot flow, which reaches its own horizon, the inner edge is the
    // horizon — so the circular branch was being asked for orbits from
    // the photon sphere down, where r² − 3r + 2a√r is negative and the
    // clamp under its square root returns an energy ten thousand times
    // too large. The result is not timelike, −p·u passes through zero
    // somewhere inside it, and a stray pixel comes back hundreds of
    // times blueshifted and thousands of times too bright.
    const norm = (r: number, spin: number, inner: number): number => {
      const u = flowFourVelocity(r, spin, inner);
      const sigma = r * r;
      const delta = r * r - 2 * r + spin * spin;
      const bigA = (r * r + spin * spin) ** 2 - spin * spin * delta;
      return (
        -(1 - 2 / r) * u.ut * u.ut -
        ((4 * spin) / r) * u.ut * u.uphi +
        (sigma / delta) * u.ur * u.ur +
        (bigA / sigma) * u.uphi * u.uphi
      );
    };
    // Handed the horizon, as a hot flow used to hand it, the same
    // expression comes back spacelike by eight orders of magnitude.
    expect(norm(1.4736, 0.89, horizonRadiusRg(0.89))).toBeGreaterThan(1e6);
    expect(norm(1.4736, 0.89, iscoRadiusRg(0.89))).toBeCloseTo(-1, 6);
    // And the shader is asking for the right one now.
    expect(GEODESIC_GLSL).toContain('kerrFlowVelocity(rMid, a, uIscoRg)');
    expect(GEODESIC_GLSL).toContain('kerrFlowVelocity(rHit, a, uIscoRg)');
    expect(GEODESIC_GLSL).not.toContain('kerrFlowVelocity(rMid, a, uInnerRg)');

    for (const spin of [0, 0.5, 0.89, 0.998]) {
      const horizon = horizonRadiusRg(spin);
      const isco = iscoRadiusRg(spin);
      for (let i = 1; i <= 60; i++) {
        const r = horizon * 1.001 + ((isco * 3 - horizon) * i) / 60;
        // u·u = −1, in the equatorial Kerr metric, everywhere from
        // just outside the horizon to well beyond the last stable orbit.
        expect(norm(r, spin, isco)).toBeCloseTo(-1, 6);
      }
    }
  });

  it('aims the trace where the camera points now, not where it pointed', () => {
    // The traced image is the whole picture at the distances a hole is
    // looked at from, so if it is aimed anywhere but exactly where the
    // camera is pointing, the hole slides across the screen. It was.
    //
    // three rebuilds a camera's world matrix when the scene renders,
    // which happens after the trace is drawn — so reading the
    // orientation off matrixWorld gives last frame's, while the
    // position is read off the camera directly and is current. Still,
    // the two agree and nothing shows; orbiting, they differ by exactly
    // one frame of rotation, which measured fifty device pixels of
    // sideways drift at a brisk drag.
    //
    // This is what that staleness looks like, so the reason the call
    // below exists is written down rather than remembered:
    const camera = new PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const settled = new Quaternion().setFromRotationMatrix(camera.matrixWorld);

    // Move it the way an orbit control does — position and quaternion,
    // no matrix update — and the world matrix still holds the old one.
    camera.position.set(10, 0, 0);
    camera.lookAt(0, 0, 0);
    const stale = new Quaternion().setFromRotationMatrix(camera.matrixWorld);
    expect(stale.angleTo(settled)).toBeLessThan(1e-9);
    expect(stale.angleTo(camera.quaternion)).toBeGreaterThan(1);

    // Updating it first is what makes the two agree.
    camera.updateMatrixWorld();
    const fresh = new Quaternion().setFromRotationMatrix(camera.matrixWorld);
    expect(fresh.angleTo(camera.quaternion)).toBeLessThan(1e-9);

    // And the trace does update it first.
    const before = BLACK_HOLE_SOURCE.indexOf('camera.updateMatrixWorld()');
    const reads = BLACK_HOLE_SOURCE.indexOf('setFromMatrix4(camera.matrixWorld)');
    expect(before).toBeGreaterThan(-1);
    expect(reads).toBeGreaterThan(before);
  });

  it('draws the physical flow extent while framing the bright inner region', () => {
    const torus = { regime: 'riaf', innerRadiusRg: 1.36, outerRadiusRg: 60 };
    const disc = { regime: 'thin-disc', innerRadiusRg: 4.24, outerRadiusRg: 1640 };
    expect(drawnFlowRadiusRg(torus)).toBe(60);
    expect(drawnFlowRadiusRg(disc)).toBe(1640);
    expect(framedFlowRadiusRg(torus)).toBeCloseTo(1.36 * FLOW_DRAW_SPAN, 6);
    expect(framedFlowRadiusRg(disc)).toBeCloseTo(4.24 * FLOW_DRAW_SPAN, 6);
    expect(framedFlowRadiusRg({ innerRadiusRg: 1.36, outerRadiusRg: 8 })).toBe(8);
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
