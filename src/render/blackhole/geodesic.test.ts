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

  it('keeps the two realisations from being the same realisation', () => {
    // Counted plainly, floor(t) and floor(t+½) agree for half of every
    // cycle, so the two fields the crossfade blends were drawn from the
    // same offset in the noise — different only by how far the shear
    // had wound them apart, which at the flow's inner edge is not at
    // all. Two copies of one field do not blend to a steady contrast:
    // sin+cos runs between one and √2, so the clumping beat by forty
    // percent every orbit at the very radius that is brightest.
    for (let i = 0; i <= 400; i++) {
      const t = (i / 400) * 4;
      const a = Math.floor(t);
      const b = Math.floor(t + 0.5) + 0.5;
      expect(a).not.toBe(b);
      // And they part company by a whole generation across a cycle, so
      // neither is ever a stale copy of the other.
      expect(Math.abs(a - b)).toBeGreaterThanOrEqual(0.5);
    }
    expect(GEODESIC_GLSL).toContain('floor(t + 0.5) + 0.5');
  });

  it('draws every generation from somewhere a float can still resolve', () => {
    // Walking the sample point a fixed distance per generation is fine
    // until the offset dwarfs the ±4 the pattern itself spans. Then the
    // spacing between representable coordinates grows past the noise's
    // own cells, the field comes back flat, and the clumping dissolves
    // into an even glow — which is what a disc watched above real time
    // used to do within seconds. Hashed into a box instead, the offset
    // never leaves the range a float resolves finely.
    const offset = (generation: number): number[] => {
      const fract = (x: number): number => x - Math.floor(x);
      const h = [0.1031, 0.11369, 0.13787].map((c) => fract((generation % 4096) * c));
      const d = h[0] * (h[1] + 33.33) + h[1] * (h[2] + 33.33) + h[2] * (h[0] + 33.33);
      const g = h.map((x) => x + d);
      return [
        fract((g[0] + g[1]) * g[2]),
        fract((g[0] + g[2]) * g[1]),
        fract((g[1] + g[2]) * g[0]),
      ].map((x) => x * 128);
    };
    // Bounded, for any generation a session could ever reach.
    for (const g of [0, 1, 41, 4095, 4096, 1e5, 1e7]) {
      for (const c of offset(g)) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(128);
        // Still resolved far finer than one noise cell, which is what
        // the unbounded offset stopped being.
        expect(Math.fround(c + 1) - Math.fround(c)).toBeCloseTo(1, 4);
      }
    }
    // Consecutive generations land somewhere genuinely else.
    for (let g = 0; g < 40; g++) {
      const [a, b] = [offset(g), offset(g + 1)];
      const apart = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      expect(apart).toBeGreaterThan(4);
    }
    expect(GEODESIC_GLSL).toContain('eddyOffset(generation)');
    expect(GEODESIC_GLSL).not.toContain('generation * vec3(');
  });

  it('folds the bulk rotation before a float has to add an azimuth to it', () => {
    // The pattern's angle is only ever read through a sine and a
    // cosine, so the whole count of turns contributes nothing but its
    // own magnitude — and its magnitude is what stops a float from
    // resolving φ. At a hundred thousand turns the azimuth is down to a
    // hundred distinguishable places around the ring; at a million
    // there is one, and the disc is a set of perfectly smooth
    // concentric bands. Folded first, φ keeps every digit it had.
    const TAU = 2 * Math.PI;
    // How many distinct angles a float can still tell apart around one
    // circuit, once this many turns have been added to them: the gap
    // between neighbouring floats at that magnitude, against 2π.
    const resolvedPlaces = (turns: number): number => {
      const base = Math.abs(Math.fround(TAU * turns));
      if (base === 0) return Infinity;
      return TAU / 2 ** (Math.floor(Math.log2(base)) - 23);
    };
    expect(resolvedPlaces(1e6)).toBeLessThan(64);
    expect(resolvedPlaces(1e5)).toBeLessThan(256);
    // Folded, every count of turns resolves the ring the same way.
    for (const turns of [0.25, 1e3, 1e6, 1e9]) {
      expect(resolvedPlaces(turns - Math.floor(turns))).toBeGreaterThan(1e6);
    }
    expect(GEODESIC_GLSL).toContain('TAU * uFlowSpin');
    expect(GEODESIC_GLSL).not.toContain('TAU * uFlowPhase');
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
