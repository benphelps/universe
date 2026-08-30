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
  DISPLAY_FALLOFF,
  FLOW_DRAW_SPAN,
  GEODESIC_GLSL,
  LENSING_REACH_RG,
  drawnFlowRadiusRg,
  framedFlowRadiusRg,
  profileStretch,
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

  it('hands one generation to the next without inverting it', () => {
    // Two generations overlap by half a lifetime, and the crossfade
    // has to satisfy three things at once: neither weight negative,
    // both vanishing at their own birth and death, and their squares
    // summing to one so the clumping's contrast does not dull halfway
    // through the handover.
    //
    // Quadrature over a half turn gets the third and fails the first.
    // It carries the older realisation down through zero to minus one,
    // and then at the slot boundary that same realisation — same hash,
    // same age — is read again at plus one. Nothing about the field
    // changes; its sign does. Dense goes sparse between two frames.
    const halfTurn = (f: number): number => Math.cos(Math.PI * f);
    expect(halfTurn(0.99)).toBeLessThan(-0.9);
    expect(halfTurn(0)).toBeGreaterThan(0.9);
    // Over a quarter turn instead, every weight is a rise from nothing
    // and a fall back to it, and the boundary is a plain relabelling:
    // what was the new one at the end of its slot is the old one at
    // the start of the next, at the same weight and the same age.
    const wNew = (f: number): number => Math.sin((Math.PI / 2) * f);
    const wOld = (f: number): number => Math.cos((Math.PI / 2) * f);
    expect(wNew(1)).toBeCloseTo(wOld(0), 12);
    const ageNew = (f: number): number => 0.5 * f;
    const ageOld = (f: number): number => 0.5 * (1 + f);
    expect(ageNew(1)).toBeCloseTo(ageOld(0), 12);
    for (let i = 0; i <= 400; i++) {
      const f = i / 400;
      expect(wNew(f)).toBeGreaterThanOrEqual(0);
      expect(wOld(f)).toBeGreaterThanOrEqual(0);
      expect(wNew(f) ** 2 + wOld(f) ** 2).toBeCloseTo(1, 12);
      // The two are never the same realisation: one generation apart,
      // always, so neither is a stale copy of the other.
      const t = f * 4;
      expect(Math.abs(Math.floor(t) - (Math.floor(t) - 1))).toBe(1);
    }
    // Born at nothing and retired at nothing, so a generation is never
    // introduced or dropped where it could be seen.
    expect(wNew(0)).toBeCloseTo(0, 12);
    expect(wOld(1)).toBeCloseTo(0, 12);
    expect(GEODESIC_GLSL).toContain('sin(1.5707963 * f)');
    expect(GEODESIC_GLSL).toContain('cos(1.5707963 * f)');
    expect(GEODESIC_GLSL).not.toContain('sin(3.14159265 * phase)');
  });

  it('keeps the winding, and its slope across the radius, bounded', () => {
    // Two ways for a rotating pattern to destroy itself, and only one
    // of them is about the size of a number.
    //
    // The first is the angle. It is read through a sine and a cosine,
    // so a whole count of turns adds nothing but its own magnitude —
    // and its magnitude is what stops a float resolving φ. At a
    // hundred thousand turns the azimuth is down to a hundred
    // distinguishable places around the ring; at a million there is
    // one, and the disc is a set of perfectly smooth bands.
    const TAU = 2 * Math.PI;
    const resolvedPlaces = (turns: number): number => {
      const base = Math.abs(Math.fround(TAU * turns));
      if (base === 0) return Infinity;
      return TAU / 2 ** (Math.floor(Math.log2(base)) - 23);
    };
    expect(resolvedPlaces(1e6)).toBeLessThan(64);
    expect(resolvedPlaces(1e5)).toBeLessThan(256);

    // The second is the slope, and it is the one that was actually
    // wrong. The winding may sit inside a single turn and still be
    // useless, because what draws the clumping is how much of it is
    // packed into an e-fold of radius. The pattern is sampled on a
    // ring four noise cells across, so a turn of winding per e-fold is
    // this many cells of structure across one:
    const cellsPerTurn = TAU * 4;
    // and an e-fold of the inner disc covers a couple of hundred
    // pixels, so past a few turns per e-fold there is nothing left to
    // see but aliasing.
    const keplerian = (rOverInner: number): number => rOverInner ** -1.5;

    // A clock per radius: the phase is fract(T Ω), the age is that
    // over Ω, and the winding is the age against a fixed reference.
    // Differentiating in ln r, with dΩ/dln r = −1.5 Ω, the floor term
    // survives — and it counts elapsed orbits.
    const slopePerRadius = (rOverInner: number, turns: number): number => {
      const k = keplerian(rOverInner);
      const orbits = Math.floor(turns * k);
      return Math.abs(-1.5 * (orbits * (k - 1)) / k - 1.5 * ((turns * k) % 1));
    };
    // One clock for the flow: the age has no radial variation at all,
    // so only Ω itself carries one.
    const slopeShared = (rOverInner: number, turns: number): number =>
      Math.abs((turns % 1) * -1.5 * keplerian(rOverInner));

    // Four gravitational radii out, the old slope grows without bound
    // with time — it is proportional to the orbits elapsed — and is
    // already past anything renderable within a minute of watching.
    const grew = [10, 100, 1000].map((t) => slopePerRadius(4, t));
    expect(grew[1] / grew[0]).toBeGreaterThan(5);
    expect(grew[2] / grew[1]).toBeGreaterThan(5);
    expect(grew[0] * cellsPerTurn).toBeGreaterThan(200);
    expect(grew[2] * cellsPerTurn).toBeGreaterThan(20000);

    // Shared, the slope never exceeds one and a half turns per e-fold
    // — that is r dΩ/dr over a lifetime, and it is the same however
    // long anyone has been watching.
    for (const turns of [0.25, 10.5, 1e3 + 0.5, 1e6 + 0.5, 1e9 + 0.5]) {
      for (const rOverInner of [1, 2, 4, 12, 40]) {
        expect(slopeShared(rOverInner, turns)).toBeLessThanOrEqual(1.5);
      }
      // And the angle itself stays inside a turn, so φ keeps every
      // digit it had.
      expect(resolvedPlaces((turns % 1) * keplerian(1))).toBeGreaterThan(1e6);
    }

    // The clock is one clock, and the winding is the local rate times
    // an age that resets with the generation.
    expect(GEODESIC_GLSL).toContain('float t = 2.0 * uFlowPhase / EDDY_LIFETIME;');
    expect(GEODESIC_GLSL).toContain('TAU * age * keplerian');
    expect(GEODESIC_GLSL).not.toContain('uFlowPhase * keplerian');
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

  it('draws a torus whole and a disc only as far as it is worth', () => {
    // Only one of the two regimes has decades of cold outskirts to
    // leave off. A hot flow ends where the hot gas ends — sixty r_g,
    // a real edge and a near one — and it is bright to that rim, so
    // the span that spares a disc its cold tail was cutting the torus
    // off at a quarter of itself for nothing.
    const torus = { regime: 'riaf', innerRadiusRg: 1.36, outerRadiusRg: 60 };
    expect(drawnFlowRadiusRg(torus)).toBe(60);
    expect(drawnFlowRadiusRg(torus) / (torus.innerRadiusRg * FLOW_DRAW_SPAN)).toBeGreaterThan(3);

    // A disc's own edge is where its gravity fragments it, hundreds of
    // inner radii out, and it keeps the limit.
    const disc = { regime: 'thin-disc', innerRadiusRg: 4.24, outerRadiusRg: 1640 };
    expect(drawnFlowRadiusRg(disc)).toBeCloseTo(4.24 * FLOW_DRAW_SPAN, 6);

    // Where the camera stands is the other question, and it is the
    // bright part in both regimes. Answering both with one number is
    // what made drawing the whole torus cost the shadow two thirds of
    // its size — the flow got bigger, so the camera backed away from
    // the thing the picture is of.
    expect(framedFlowRadiusRg(torus)).toBeCloseTo(1.36 * FLOW_DRAW_SPAN, 6);
    expect(framedFlowRadiusRg(disc)).toBe(drawnFlowRadiusRg(disc));
    // A flow smaller than the span is framed on itself, never beyond.
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
