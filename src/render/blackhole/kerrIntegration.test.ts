import { describe, expect, it } from 'vitest';
import {
  axisAzimuth,
  criticalConstants,
  delta,
  equatorAzimuthJump,
  photonFromDirection,
  polarFromSinSq,
  polarPotential,
  polarTurningSinSq,
  radialPotential,
  shadowOutline,
  type PhotonRay,
} from '../../core/physics/kerr';
import { horizonRadiusRg } from '../../core/physics/blackHole';
import { GEODESIC_GLSL } from './geodesicGlsl';
import { KERR_GLSL } from './kerrGlsl';

/**
 * The shader's marching loop, in TypeScript.
 *
 * kerrGlsl cannot be run here, so this mirrors it: the same separated
 * equations, the same Mino-time step rule, the same fourth-order
 * scheme, the same step constant read out of the shader source so the
 * two cannot drift apart silently. What it buys is the test the
 * approximate treatments cannot pass — integrating thousands of rays
 * and finding that the boundary between the ones that fall and the ones
 * that escape is Bardeen's critical curve, to a fraction of a percent,
 * with nothing fitted.
 */
const STEP_EPS = Number(
  /const float STEP_EPS = ([0-9.]+);/.exec(GEODESIC_GLSL)?.[1] ??
    (() => {
      throw new Error('the tracer no longer declares STEP_EPS');
    })(),
);

interface State {
  r: number;
  mu: number;
  phi: number;
  dr: number;
  dmu: number;
}

/** sin²θ, carried alongside μ exactly as the shader carries it. */
function startingSinSq(mu: number): number {
  return Math.max(1 - mu * mu, 0);
}

function rates(r: number, mu: number, dr: number, dmu: number, a: number, ray: PhotonRay) {
  const p = r * r + a * a - a * ray.xi;
  const kk = (ray.xi - a) * (ray.xi - a) + ray.eta;
  return {
    dr,
    dmu,
    ddr: 2 * r * p - (r - 1) * kk,
    ddmu: -mu * (ray.eta + ray.xi * ray.xi - a * a) - 2 * a * a * mu * mu * mu,
  };
}

/** The bounded half of dφ/dσ; the other half is closed form. */
function phiRate(r: number, mu: number, a: number, xi: number): number {
  const p = r * r + a * a - a * xi;
  return (a * p) / (r * r - 2 * r + a * a) - a + xi / (1 + Math.abs(mu));
}

/** All of dφ/dσ, ξ/sin²θ and all, for the comparison that shows why
 *  it is not integrated this way. */
function wholeRate(r: number, mu: number, a: number, xi: number): number {
  const p = r * r + a * a - a * xi;
  return (a * p) / (r * r - 2 * r + a * a) - a + xi / Math.max(1 - mu * mu, 1e-14);
}

interface Outcome {
  captured: boolean;
  /** Total azimuth swept, radians — π plus the deflection for a pass. */
  sweep: number;
  turningRadius: number;
  steps: number;
  /** How many times the ray crossed the equatorial plane inside the
   *  radius a flow would occupy: one image of the disc per crossing. */
  crossings: number;
  /** The nearest the ray came to the spin axis, as sin²θ. */
  closestSinSq: number;
  /** Where the trace ended, and the sin²θ it carried there. */
  end: State;
  endSinSq: number;
}

/** March one ray until it falls in or leaves, exactly as the shader does. */
function march(
  start: State,
  ray: PhotonRay,
  spin: number,
  reach: number,
  maxSteps = 40000,
  eps = STEP_EPS,
  /** Integrate ξ/sin²θ whole, the way it was done before the split.
   *  Only a test asks for this — it is the thing being checked. */
  direct = false,
): Outcome {
  const a = spin;
  const horizon = horizonRadiusRg(a) + 0.002;
  let { r, mu, phi, dr, dmu } = start;
  let sinSq = startingSinSq(mu);
  const jump = equatorAzimuthJump(ray, a);
  const phi0 = phi;
  let turningRadius = r;
  let crossings = 0;
  let closestSinSq = sinSq;
  for (let i = 0; i < maxSteps; i++) {
    const done = (captured: boolean): Outcome => ({
      captured, sweep: phi - phi0, turningRadius, steps: i, crossings, closestSinSq,
      end: { r, mu, phi, dr, dmu }, endSinSq: sinSq,
    });
    if (r < horizon) return done(true);
    if (r > reach && dr < 0) return done(false);
    turningRadius = Math.min(turningRadius, r);
    closestSinSq = Math.min(closestSinSq, sinSq);

    const rate =
      Math.abs(dr) / Math.max(r, 1) +
      Math.abs(dmu) +
      Math.abs(direct ? wholeRate(r, mu, a, ray.xi) : phiRate(r, mu, a, ray.xi));
    const ds = -eps / Math.max(rate, 1e-4);

    const before = mu;
    const k1 = rates(r, mu, dr, dmu, a, ray);
    const k2 = rates(
      r + k1.dr * ds * 0.5, mu + k1.dmu * ds * 0.5,
      dr + k1.ddr * ds * 0.5, dmu + k1.ddmu * ds * 0.5, a, ray,
    );
    const k3 = rates(
      r + k2.dr * ds * 0.5, mu + k2.dmu * ds * 0.5,
      dr + k2.ddr * ds * 0.5, dmu + k2.ddmu * ds * 0.5, a, ray,
    );
    const k4 = rates(
      r + k3.dr * ds, mu + k3.dmu * ds,
      dr + k3.ddr * ds, dmu + k3.ddmu * ds, a, ray,
    );
    const s1 = -2 * mu * k1.dmu;
    const s2 = -2 * (mu + k1.dmu * ds * 0.5) * k2.dmu;
    const s3 = -2 * (mu + k2.dmu * ds * 0.5) * k3.dmu;
    const s4 = -2 * (mu + k3.dmu * ds) * k4.dmu;
    const w = direct ? wholeRate : phiRate;
    const w1 = w(r, mu, a, ray.xi);
    const w2 = w(r + k1.dr * ds * 0.5, mu + k1.dmu * ds * 0.5, a, ray.xi);
    const w3 = w(r + k2.dr * ds * 0.5, mu + k2.dmu * ds * 0.5, a, ray.xi);
    const w4 = w(r + k3.dr * ds, mu + k3.dmu * ds, a, ray.xi);
    const prevArc = axisAzimuth(sinSq, mu, dmu, ray, a);
    const prevBranch = mu * dmu < 0 ? -1 : 1;

    r += (ds / 6) * (k1.dr + 2 * k2.dr + 2 * k3.dr + k4.dr);
    mu += (ds / 6) * (k1.dmu + 2 * k2.dmu + 2 * k3.dmu + k4.dmu);
    dr += (ds / 6) * (k1.ddr + 2 * k2.ddr + 2 * k3.ddr + k4.ddr);
    dmu += (ds / 6) * (k1.ddmu + 2 * k2.ddmu + 2 * k3.ddmu + k4.ddmu);
    sinSq += (ds / 6) * (s1 + 2 * s2 + 2 * s3 + s4);
    phi += (ds / 6) * (w1 + 2 * w2 + 2 * w3 + w4);
    // The same projection back onto the constraint the shader applies,
    // reflecting off a turning point the step went past.
    const reflect = (value: number, potential: number, slope: number): number =>
      2 * (value - potential / (Math.abs(slope) < 1e-12 ? 1e-12 : slope)) - value;
    let radial = radialPotential(r, ray, a);
    if (radial < 0) {
      const kk = (ray.xi - a) * (ray.xi - a) + ray.eta;
      r = reflect(r, radial, 4 * r ** 3 + 2 * (a * a - ray.xi ** 2 - ray.eta) * r + 2 * kk);
      dr = -dr;
      radial = Math.max(radialPotential(r, ray, a), 0);
    }
    dr = (dr < 0 ? -1 : 1) * Math.sqrt(radial);
    const turn = polarTurningSinSq(mu, ray, a);
    if (sinSq < turn) {
      sinSq = 2 * turn - sinSq;
      dmu = -dmu;
    }
    sinSq = Math.min(1, Math.max(0, sinSq));
    if (sinSq < 0.25) mu = (mu < 0 ? -1 : 1) * Math.sqrt(1 - sinSq);
    else sinSq = 1 - mu * mu;
    dmu = (dmu < 0 ? -1 : 1) * Math.sqrt(Math.max(polarFromSinSq(sinSq, mu, ray, a), 0));
    // The half of the azimuth the pole owns, differenced rather than
    // integrated, and put back on one branch across the equator.
    if (!direct) {
      phi += axisAzimuth(sinSq, mu, dmu, ray, a) - prevArc;
      if (before * mu < 0) phi -= prevBranch * jump;
    }
    // One image of the disc per crossing of its plane inside the flow.
    if (before * mu < 0 && r < 60) crossings++;
  }
  return {
    captured: true, sweep: phi - phi0, turningRadius, steps: maxSteps, crossings, closestSinSq,
    end: { r, mu, phi, dr, dmu }, endSinSq: sinSq,
  };
}

/**
 * The direction the ray is travelling, in the space the shader draws
 * in — kerrHeading, mirrored. This is what a pixel finally points at.
 */
function heading(
  state: { r: number; mu: number; phi: number; dr: number; dmu: number },
  sinSq: number,
  ray: PhotonRay,
  a: number,
): [number, number, number] {
  const { r, mu, phi, dr, dmu } = state;
  const s = Math.sqrt(Math.max(sinSq, 1e-14));
  const rho = Math.sqrt(r * r + a * a);
  const overSin = ray.xi / s;
  const polar =
    (dmu > 0 ? -1 : 1) *
    Math.sqrt(Math.max(ray.eta + a * a * mu * mu - overSin * overSin * mu * mu, 0));
  const p = r * r + a * a - a * ray.xi;
  const azimuth = rho * (s * ((a * p) / delta(r, a) - a) + overSin);
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const radial = (r * dr) / rho;
  const v: [number, number, number] = [
    radial * s * cp + rho * mu * polar * cp - azimuth * sp,
    radial * s * sp + rho * mu * polar * sp + azimuth * cp,
    dr * mu - r * s * polar,
  ];
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** A ray coming inward from `reach` with the given constants. */
function inbound(ray: PhotonRay, spin: number, reach: number, muSign = 1): State {
  return {
    r: reach,
    mu: 0,
    phi: 0,
    dr: Math.sqrt(Math.max(radialPotential(reach, ray, spin), 0)),
    dmu: muSign * Math.sqrt(Math.max(polarPotential(0, ray, spin), 0)),
  };
}

describe('the traced shadow', () => {
  // The claim this whole file exists to check. For a spread of angular
  // momenta, find by bisection the Carter constant at which the
  // integrator stops swallowing rays and starts letting them past, and
  // compare it against the closed-form critical curve. Nothing is
  // fitted and nothing is tuned: if the equations, the initial
  // conditions or the step rule were wrong, these would not meet.
  for (const spin of [0, 0.5, 0.9, 0.998]) {
    it(`finds the critical curve by integration at a = ${spin}`, () => {
      const reach = 600;
      const range =
        spin < 0.01
          ? [-5, -2.5, 0, 2.5, 5]
          : [-6, -4, -2, 0, 1.5, 2.5];
      for (const xi of range) {
        const analytic = criticalEta(xi, spin);
        if (analytic === null) continue;
        let lo = analytic * 0.5;
        let hi = analytic * 1.5 + 1;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          const ray: PhotonRay = { xi, eta: mid, dr: 0, dmu: 0 };
          if (march(inbound(ray, spin, reach), ray, spin, reach).captured) lo = mid;
          else hi = mid;
        }
        const found = (lo + hi) / 2;
        expect(Math.abs(found - analytic) / Math.max(analytic, 1)).toBeLessThan(0.004);
      }
    });
  }

  it('reproduces the D-shaped outline the analytic curve draws', () => {
    // The same comparison in the observer's own sky coordinates, which
    // is what actually reaches the screen: for a near-extremal hole
    // seen edge-on the traced silhouette must run from −2.1 to +7.0.
    const spin = 0.998;
    const reach = 600;
    const edge = (xi: number): number => {
      let lo = 0.01;
      let hi = 60;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const ray: PhotonRay = { xi, eta: mid, dr: 0, dmu: 0 };
        if (march(inbound(ray, spin, reach), ray, spin, reach).captured) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };
    const analytic = shadowOutline(spin, Math.PI / 2, 2048);
    const alphas = analytic.map(([alpha]) => alpha);
    // Edge-on, α is just −ξ, so the extremes of the traced silhouette
    // are the extreme angular momenta that still get swallowed. Bisect
    // for each rather than scanning, or the answer is only as good as
    // the scan is fine.
    const extreme = (inside: number, outside: number): number => {
      let lo = inside;
      let hi = outside;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (edge(mid) > 0.05) lo = mid;
        else hi = mid;
      }
      return -(lo + hi) / 2;
    };
    expect(extreme(0, 2.6)).toBeCloseTo(Math.min(...alphas), 2);
    expect(extreme(-6, -7.4)).toBeCloseTo(Math.max(...alphas), 2);
  });
});

/** η on the critical curve at this ξ, or null if no orbit carries it. */
function criticalEta(xi: number, spin: number): number | null {
  if (spin < 0.01) return 27 - xi * xi > 0 ? 27 - xi * xi : null;
  let lo = 2 * (1 + Math.cos((2 / 3) * Math.acos(-spin)));
  let hi = 2 * (1 + Math.cos((2 / 3) * Math.acos(spin)));
  if (xi > criticalConstants(lo, spin).xi || xi < criticalConstants(hi, spin).xi) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (criticalConstants(mid, spin).xi > xi) lo = mid;
    else hi = mid;
  }
  const eta = criticalConstants((lo + hi) / 2, spin).eta;
  return eta > 0.05 ? eta : null;
}

describe('the traced deflection', () => {
  it('bends light the way general relativity does, not the way Newton would', () => {
    // The integrator's zero point: get this wrong and every lensed
    // image is the wrong size. The trace has to start somewhere finite,
    // and a straight line from there already sweeps 2·arccos(b/R)
    // rather than the full π, so that much is owed back first.
    //
    // The sharper claim is the second one. A light-bending calculation
    // can be wrong and still land on 4/b, because that much falls out
    // of a Newtonian argument with the right factor of two. What does
    // not is the next term, 15π/4b², which is a genuine curvature
    // correction — and at b = 200 it lifts the deflection a percent and
    // a half above 4/b, which the trace finds.
    for (const [b, tolerance] of [[200, 3e-3], [500, 3e-3], [1500, 5e-3]] as Array<
      [number, number]
    >) {
      const ray: PhotonRay = { xi: b, eta: 0, dr: 0, dmu: 0 };
      const reach = 4000 * b;
      const out = march(inbound(ray, 0, reach), ray, 0, reach);
      expect(out.captured).toBe(false);
      const deflection = Math.abs(out.sweep) - 2 * Math.acos(b / reach);
      const relativistic = 4 / b + (15 * Math.PI) / (4 * b * b);
      expect(Math.abs(deflection - relativistic) / relativistic).toBeLessThan(tolerance);
    }

    // The correction is a percent and a half of a quantity the trace
    // knows to about a thousandth, so reading it off cleanly asks for a
    // finer step than the shader can afford per pixel. Refined, the
    // coefficient comes back within a few percent of 15π/16b.
    const b = 200;
    const ray: PhotonRay = { xi: b, eta: 0, dr: 0, dmu: 0 };
    const reach = 4000 * b;
    const fine = march(inbound(ray, 0, reach), ray, 0, reach, 40000, STEP_EPS / 10);
    const excess = (Math.abs(fine.sweep) - 2 * Math.acos(b / reach)) / (4 / b) - 1;
    expect(excess / ((15 * Math.PI) / (16 * b))).toBeGreaterThan(0.97);
    expect(excess / ((15 * Math.PI) / (16 * b))).toBeLessThan(1.07);
  });

  it('winds many times just outside the critical impact parameter', () => {
    // The photon ring: rays that skim the unstable orbit loop before
    // they leave, and each extra loop is a fainter copy of the sky.
    const reach = 600;
    // Equatorial, so the winding is in φ and the sweep counts it. A
    // ray with all its impact parameter in the Carter constant winds
    // just as many times, but does it in θ, where this does not look.
    const loops = (excess: number): number => {
      const b = 3 * Math.sqrt(3) * (1 + excess);
      const ray: PhotonRay = { xi: b, eta: 0, dr: 0, dmu: 0 };
      const out = march(inbound(ray, 0, reach), ray, 0, reach);
      return Math.abs(out.sweep) / (2 * Math.PI);
    };
    expect(loops(0.2)).toBeLessThan(0.75);
    expect(loops(1e-3)).toBeGreaterThan(1);
    expect(loops(1e-7)).toBeGreaterThan(2);
  });

  it('crosses the equatorial plane again and again near the photon orbit', () => {
    // Higher-order images. A ray that skims the unstable circular orbit
    // passes through the disc's plane once on the way in and again on
    // every half turn it makes before it leaves, and each of those is a
    // fainter, thinner copy of the disc stacked at the shadow's edge —
    // the secondary and tertiary Einstein rings.
    //
    // Resolving them is a property of the step rule rather than a
    // special case bolted on near the photon sphere: the polar rate is
    // one of the terms that sets the step, so a ray winding in θ is
    // stepped finely exactly where it needs to be and cannot step over
    // its own crossings.
    const reach = 600;
    const crossings = (excess: number): number => {
      const b = 3 * Math.sqrt(3) * (1 + excess);
      // Tilted: some angular momentum about the axis, the rest in
      // Carter's constant, so the ray genuinely crosses the plane.
      const xi = 0.5 * b;
      const ray: PhotonRay = { xi, eta: b * b - xi * xi, dr: 0, dmu: 0 };
      return march(inbound(ray, 0, reach), ray, 0, reach).crossings;
    };
    // Well clear of the critical parameter a ray crosses once and is
    // gone, and that is the disc you see. Approaching it the count
    // climbs as the logarithm of how close you are, which is the rate
    // the winding itself diverges at — one more image per factor of a
    // few hundred, all the way down to a part in a million million.
    expect(crossings(0.5)).toBe(1);
    expect(crossings(1e-5)).toBeGreaterThanOrEqual(3);
    expect(crossings(1e-8)).toBeGreaterThanOrEqual(5);
    expect(crossings(1e-12)).toBeGreaterThanOrEqual(8);
  });

  it('turns around exactly at the radial potential’s root', () => {
    // The closest approach has to be where R(r) vanishes, or the
    // integrator is not on the geodesic it thinks it is.
    const spin = 0.9;
    const ray: PhotonRay = { xi: 3, eta: 20, dr: 0, dmu: 0 };
    const reach = 600;
    const out = march(inbound(ray, spin, reach), ray, spin, reach);
    expect(out.captured).toBe(false);
    let lo = horizonRadiusRg(spin);
    let hi = reach;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (radialPotential(mid, ray, spin) < 0) lo = mid;
      else hi = mid;
    }
    expect(out.turningRadius).toBeCloseTo((lo + hi) / 2, 2);
  });
});

describe('the spin axis', () => {
  /**
   * The observer that made this necessary: near enough the axis to be
   * looking down it, which is where every ray on screen carries almost
   * no angular momentum about the pole and passes close enough to it
   * that ξ/sin²θ runs away. Fifteen degrees above the flow the problem
   * does not arise at all, which is why it went unnoticed.
   */
  const spin = 0.89;
  const camR = 28;
  const camMu = 0.9975;
  const reach = 140;
  /** Aimed to pass the hole around twelve gravitational radii out,
   *  which is where the seam was reproduced. */
  const psi = 0.436;

  /** A photon arriving with `nPhi` of azimuthal tilt, and where on the
   *  sky the trace says it came from. */
  const shot = (nPhi: number, eps = STEP_EPS, direct = false, standOff = false) => {
    const nTheta = -Math.sqrt(Math.max(Math.sin(psi) ** 2 - nPhi * nPhi, 0));
    let ray = photonFromDirection(camR, camMu, spin, [Math.cos(psi), nTheta, nPhi]);
    if (standOff) {
      // The treatment this replaced: no ray was allowed nearer the
      // axis than sin²θ = 3·10⁻⁴, so any that would have gone closer
      // had its angular momentum pushed out to the least that kept it
      // integrable. Kept here because it is what the comparison below
      // is against.
      const floor = Math.sqrt(3e-4 * (ray.eta + spin * spin));
      if (Math.abs(ray.xi) < floor) ray = { ...ray, xi: ray.xi < 0 ? -floor : floor };
    }
    const out = march(
      { r: camR, mu: camMu, phi: 0, dr: ray.dr, dmu: ray.dmu },
      ray, spin, reach, 4000000, eps, direct,
    );
    return { ray, out, dir: heading(out.end, out.endSinSq, ray, spin) };
  };

  /** How the worst jump between neighbouring rays compares with the
   *  typical one, walking the aim across the axis. A seam is a number
   *  much bigger than one; a picture that holds together is a number
   *  near it. Scale-free on purpose — nothing here is tuned to a pixel
   *  size or a step count. */
  const worstJump = (standOff: boolean): number => {
    const dirs = [];
    for (let i = 0; i <= 80; i++) dirs.push(shot(-0.16 + (0.32 * i) / 80, STEP_EPS, false, standOff).dir);
    const gaps = [];
    for (let i = 1; i < dirs.length; i++) gaps.push(angleBetween(dirs[i - 1], dirs[i]));
    return Math.max(...gaps) / [...gaps].sort((x, y) => x - y)[Math.floor(gaps.length / 2)];
  };

  const angleBetween = (u: number[], v: number[]): number =>
    Math.acos(Math.min(1, Math.max(-1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])));

  it('sends neighbouring rays to neighbouring places across ξ = 0', () => {
    // The bug this section exists for. Rays either side of the axis
    // carry angular momentum of opposite sign and go round the pole
    // opposite ways, and the azimuth each accumulates differs by very
    // nearly a full turn — which is no difference at all, if it is
    // computed. Dodged instead, by holding rays off the axis, every
    // ray in a band is handed the same angular momentum with the sign
    // of whichever side it was on: a flat stripe with a step down the
    // middle of it, which is what a seam is.
    //
    // Walking the aim across the axis, the worst jump between
    // neighbours was three hundred and seventy times the typical one.
    // It is now within a fifth of it.
    expect(worstJump(true)).toBeGreaterThan(50);
    expect(worstJump(false)).toBeLessThan(1.5);

    // And the sweep does cross zero angular momentum, with the rays
    // either side of the middle genuinely threading the axis — or the
    // test would be watching the wrong thing. sinθ bottoms out at
    // |ξ|/√(η+a²), which for the ray next to the centre is a
    // twentieth of a milliradian off the pole, its neighbour on the
    // other side the mirror of it. That pair is the seam.
    expect(shot(-0.16).ray.xi).toBeLessThan(-0.1);
    expect(shot(0.16).ray.xi).toBeGreaterThan(0.1);
    const grazing = shot(0.32 / 80).ray;
    expect(Math.abs(grazing.xi) / Math.sqrt(grazing.eta + spin * spin)).toBeLessThan(1e-3);
  });

  it('keeps a picture when the camera sits on the axis', () => {
    // Looking straight down the spin axis is where the coordinates are
    // at their worst, and the whole image was collapsing there. |μ| is
    // then within a part in a million million of one, 1 − μ² is zero in
    // the single precision a shader has, and ξ — which carries a factor
    // of sinθ — comes back as exactly zero for every ray on screen.
    // Every one of them is then a photon with no angular momentum about
    // the axis, travelling in the observer's own meridian; they all
    // start at the same azimuth so they all leave at the same azimuth,
    // and a whole ring of pixels lands on one point of sky. The star
    // field turned into smooth concentric circles.
    //
    // Formed from the observer's own distance off the axis instead —
    // x² + y² = (r²+a²)sin²θ, which subtracts nothing — screen azimuth
    // maps one to one onto sky azimuth, as by symmetry it must: a
    // camera on the axis sees the sky turned, not flattened.
    const camR = 28;
    const offAxis = 1e-4;
    const sinT = offAxis / Math.sqrt(camR * camR + spin * spin);
    const camMu = -Math.sqrt(1 - sinT * sinT);

    // The subtraction really does lose it, and the geometry really does
    // keep it, at the precision the shader works in.
    expect(Math.fround(1 - Math.fround(camMu) * Math.fround(camMu))).toBe(0);
    expect(Math.fround(sinT)).toBeGreaterThan(3e-6);

    const skyAzimuth = (screenChi: number, useSinT: boolean): number => {
      // A ray aimed inward, tilted off the axis at screen azimuth chi.
      const psi = 0.36;
      const n: [number, number, number] = [
        Math.cos(psi),
        -Math.sin(psi) * Math.cos(screenChi),
        Math.sin(psi) * Math.sin(screenChi),
      ];
      const ray = useSinT
        ? photonFromDirection(camR, camMu, spin, n, sinT)
        : photonFromDirection(camR, camMu, spin, n, 0);
      const out = march(
        { r: camR, mu: camMu, phi: 0, dr: ray.dr, dmu: ray.dmu },
        ray, spin, 140, 40000, STEP_EPS,
      );
      const d = heading(out.end, out.endSinSq, ray, spin);
      return Math.atan2(d[1], d[0]);
    };

    const turns = (useSinT: boolean): number => {
      let previous = skyAzimuth(0, useSinT);
      let swept = 0;
      for (let k = 1; k <= 32; k++) {
        const here = skyAzimuth((k / 32) * 2 * Math.PI, useSinT);
        let step = here - previous;
        while (step > Math.PI) step -= 2 * Math.PI;
        while (step < -Math.PI) step += 2 * Math.PI;
        swept += step;
        previous = here;
      }
      return Math.abs(swept) / (2 * Math.PI);
    };

    // One turn of the screen is one turn of the sky.
    expect(turns(true)).toBeCloseTo(1, 2);
    // With sinθ lost, the sky does not turn at all.
    expect(turns(false)).toBeLessThan(0.05);

    // And the shader forms it the way that survives.
    expect(GEODESIC_GLSL).toContain('float sinT = length(cam.xy) / rho;');
    expect(GEODESIC_GLSL).not.toContain('sqrt(max(1.0 - camMu * camMu');
    expect(GEODESIC_GLSL).toContain('AXIS_STANDOFF');
    expect(KERR_GLSL).toContain('vec4 kerrPhoton(float r, float mu, float sinT, float a, vec3 n)');
  });

  it('is the same integral as ξ/sin²θ, taken whole', () => {
    // The split is exact rather than approximate, so refined it has to
    // land where integrating the singular form directly lands. The
    // direct one needs some fifty thousand steps to get there for a ray
    // this close to the axis, which is the reason it is not what runs.
    for (const nPhi of [0.05, 0.09, 0.16, -0.12]) {
      const split = shot(nPhi, STEP_EPS / 400);
      const whole = shot(nPhi, STEP_EPS / 400, true);
      expect(Math.abs(split.out.sweep - whole.out.sweep)).toBeLessThan(1e-3);
      // And not a close-run thing: taken whole, the same ray needs
      // orders of magnitude more steps to arrive there. Stated against
      // the split rather than as a number, so it keeps meaning this
      // when the step size changes.
      expect(whole.out.steps).toBeGreaterThan(100 * shot(nPhi).out.steps);
    }
  });

  it('costs a ray that threads the axis nothing extra to trace', () => {
    // What the closed form buys. dφ/dσ peaks at (η+a²)/ξ, so a ray a
    // millionth off the pole would want millions of steps for the
    // passage alone and no budget could hold it. Split, the rate the
    // stepper follows is bounded by the ray's own constants, and a ray
    // that goes straight over the pole costs what a ray a tenth of a
    // radian away from it costs.
    const budget = Number(/const int MAX_STEPS = ([0-9]+);/.exec(GEODESIC_GLSL)?.[1]);
    const wide = shot(0.16).out.steps;
    for (const nPhi of [1e-2, 1e-4, 1e-6, 0]) {
      expect(shot(nPhi).out.steps).toBeLessThan(budget);
      expect(shot(nPhi).out.steps).toBeLessThan(wide * 1.2);
    }
  });

  it('sweeps half a turn over the pole as the angular momentum vanishes', () => {
    // The physical content of the closed form. A ray that threads the
    // axis goes over the top of it, and the azimuth on the far side is
    // π from the azimuth on the near side however little angular
    // momentum it carries — discontinuously in sign, because the sign
    // of ξ is which side it passes, and the two are the same ray.
    //
    // It approaches that limit at a definite rate: the deficit is
    // 2|ξ|/√(η+a²), the arcsine's own square-root approach to its
    // endpoint. Matching the rate and not just the limit is what says
    // the antiderivative is the right one.
    const eta = 137;
    for (const xi of [1e-1, 1e-2, 1e-3, 1e-4]) {
      const deficit = Math.PI - equatorAzimuthJump({ xi, eta, dr: 0, dmu: 0 }, spin);
      expect(deficit / ((2 * xi) / Math.sqrt(eta + spin * spin))).toBeCloseTo(1, 2);
      // Mirrored for retrograde rays, which go round the other way.
      expect(equatorAzimuthJump({ xi: -xi, eta, dr: 0, dmu: 0 }, spin)).toBeCloseTo(
        -(Math.PI - deficit), 12,
      );
    }
    // Below what a double can resolve the deficit simply is not there,
    // and the half turn is exact — which is the limit itself.
    expect(equatorAzimuthJump({ xi: 1e-9, eta, dr: 0, dmu: 0 }, spin)).toBe(Math.PI);
  });

  it('splits the azimuthal rate without changing it', () => {
    // The identity the whole scheme rests on, checked as arithmetic:
    //   ξ/sin²θ = ξ|cosθ|/sin²θ + ξ/(1 + |cosθ|)
    // and the closed form differentiates back to the first piece.
    for (const mu of [-0.999999, -0.6, 0, 0.3, 0.9999]) {
      const sinSq = 1 - mu * mu;
      const xi = 0.7;
      expect((xi * Math.abs(mu)) / sinSq + xi / (1 + Math.abs(mu))).toBeCloseTo(xi / sinSq, 9);
    }
    // dA/dσ against the rate it stands for, along a real trajectory:
    // ds/dσ = −2μ dμ/dσ, so the chain rule closes on the state.
    const ray: PhotonRay = { xi: 0.31, eta: 150, dr: 0, dmu: 0 };
    for (const mu of [0.2, 0.9, 0.999]) {
      const sinSq = 1 - mu * mu;
      const dmu = Math.sqrt(Math.max(polarFromSinSq(sinSq, mu, ray, spin), 0));
      const h = 1e-9;
      const at = (t: number): number => {
        const s = sinSq - 2 * mu * dmu * t;
        return axisAzimuth(s, mu + dmu * t, dmu, ray, spin);
      };
      expect((at(h) - at(-h)) / (2 * h)).toBeCloseTo((ray.xi * Math.abs(mu)) / sinSq, 4);
    }
  });
});

describe('rays launched from an observer', () => {
  it('carries tetrad constants into a capture that matches the curve', () => {
    // End to end: a direction on someone's sky, through the tetrad,
    // through the integrator, to a verdict — and the verdict has to
    // agree with the closed form for every one of them.
    const spin = 0.9;
    const r = 40;
    const reach = 600;
    let checked = 0;
    for (let i = 0; i < 24; i++) {
      const psi = 0.02 + (i / 24) * 0.35;
      for (const about of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        // Outward: a photon on its way to the observer, which is what
        // the shader hands the integrator. Traced against its flight it
        // then goes in toward the hole, where capture means something.
        const n: [number, number, number] = [
          Math.cos(psi),
          Math.sin(psi) * Math.cos(about),
          Math.sin(psi) * Math.sin(about),
        ];
        const ray = photonFromDirection(r, 0, spin, n);
        const start: State = { r, mu: 0, phi: 0, dr: ray.dr, dmu: ray.dmu };
        // Trace backwards from the observer, as the shader does.
        const traced = march(start, ray, spin, reach);
        expect(traced.captured).toBe(capturedAnalytically(ray, spin));
        checked++;
      }
    }
    expect(checked).toBe(96);
  });
});

/** The shader's closed-form verdict, mirrored. */
function capturedAnalytically(ray: PhotonRay, spin: number): boolean {
  if (Math.abs(spin) < 0.01) return ray.xi * ray.xi + ray.eta < 27;
  const analytic = criticalEta(ray.xi, spin);
  return analytic !== null && ray.eta < analytic;
}

describe('the shader and the module', () => {
  it('declare the same equations', () => {
    // The mirror is only worth something if it stays one: these are the
    // lines that would have to change together.
    expect(KERR_GLSL).toContain('2.0 * r * p - (r - 1.0) * kk');
    expect(KERR_GLSL).toContain('-mu * (eta + xi * xi - a * a) - 2.0 * a * a * mu * mu * mu');
    expect(KERR_GLSL).toContain('a * p / kerrDelta(r, a) - a + xi / (1.0 + abs(mu))');
    expect(KERR_GLSL).toContain('-0.5 * sgn * branch * (asin(arg) + 1.5707963)');
    expect(GEODESIC_GLSL).toContain('STEP_EPS / max(rate, 1.0e-4)');
    // sin²θ is carried, never differenced.
    expect(GEODESIC_GLSL).toContain('sinSq += (ds / 6.0)');
    // The azimuth is split, not capped and not held off the axis.
    expect(GEODESIC_GLSL).toContain('kerrAxisAzimuth(sinSq, y.y, y.w, xi, eta, a) - prevArc');
    expect(GEODESIC_GLSL).toContain('phi -= prevBranch * equatorJump');
    expect(KERR_GLSL).not.toContain('xi / max(1.0 - mu * mu');
    expect(GEODESIC_GLSL).not.toContain('AXIS_RATE_CAP');
    expect(GEODESIC_GLSL).not.toContain('AXIS_APPROACH');
    expect(GEODESIC_GLSL).toContain('kerrProjectRadial(y, a, xi, eta)');
    expect(KERR_GLSL).toContain('kerrReflect');
    expect(GEODESIC_GLSL).toContain('40.0 * sqrt(max(impact, 0.01))');
  });

  it('gives every ray a step budget it can finish inside', () => {
    // A ray that runs out of steps is drawn as if it fell in, so the
    // budget has to clear the worst case the reach rule allows — which
    // is a near-critical ray, winding at the photon orbit before it
    // gets away. Anything tighter puts spurious black at the shadow's
    // own edge, where it would be least visible and most wrong.
    const budget = Number(/const int MAX_STEPS = ([0-9]+);/.exec(GEODESIC_GLSL)?.[1]);
    const spin = 0.9;
    let worst = 0;
    for (const [xi, eta] of [
      [0, 20], [0, 24], [2.6, 0], [-6.9, 0], [3, 20], [-4, 30], [0, 5], [5, 0],
    ] as Array<[number, number]>) {
      const ray: PhotonRay = { xi, eta, dr: 0, dmu: 0 };
      const reach = Math.max(40 * Math.sqrt(Math.hypot(xi, Math.sqrt(eta)) || 0.01), 37);
      worst = Math.max(worst, march(inbound(ray, spin, reach), ray, spin, reach).steps);
    }
    expect(worst).toBeLessThan(budget);
    // And not so far under it that the bound has stopped meaning
    // anything — a limit nothing approaches will not notice when
    // something does.
    expect(worst).toBeGreaterThan(budget / 3);
  });
});
