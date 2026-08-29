import { describe, expect, it } from 'vitest';
import {
  criticalConstants,
  photonFromDirection,
  polarPotential,
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

function phiRate(r: number, mu: number, a: number, xi: number): number {
  const p = r * r + a * a - a * xi;
  return (a * p) / (r * r - 2 * r + a * a) + xi / Math.max(1 - mu * mu, 1e-6) - a;
}

interface Outcome {
  captured: boolean;
  /** Total azimuth swept, radians — π plus the deflection for a pass. */
  sweep: number;
  turningRadius: number;
  steps: number;
}

/** March one ray until it falls in or leaves, exactly as the shader does. */
function march(
  start: State,
  ray: PhotonRay,
  spin: number,
  reach: number,
  maxSteps = 40000,
  eps = STEP_EPS,
): Outcome {
  const a = spin;
  const horizon = horizonRadiusRg(a) + 0.002;
  let { r, mu, phi, dr, dmu } = start;
  const phi0 = phi;
  let turningRadius = r;
  for (let i = 0; i < maxSteps; i++) {
    if (r < horizon) return { captured: true, sweep: phi - phi0, turningRadius, steps: i };
    if (r > reach && dr < 0) return { captured: false, sweep: phi - phi0, turningRadius, steps: i };
    turningRadius = Math.min(turningRadius, r);

    const rate =
      Math.abs(dr) / Math.max(r, 1) + Math.abs(dmu) + Math.abs(phiRate(r, mu, a, ray.xi));
    const ds = -eps / Math.max(rate, 1e-4);

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
    const w1 = phiRate(r, mu, a, ray.xi);
    const w2 = phiRate(r + k1.dr * ds * 0.5, mu + k1.dmu * ds * 0.5, a, ray.xi);
    const w3 = phiRate(r + k2.dr * ds * 0.5, mu + k2.dmu * ds * 0.5, a, ray.xi);
    const w4 = phiRate(r + k3.dr * ds, mu + k3.dmu * ds, a, ray.xi);

    r += (ds / 6) * (k1.dr + 2 * k2.dr + 2 * k3.dr + k4.dr);
    mu += (ds / 6) * (k1.dmu + 2 * k2.dmu + 2 * k3.dmu + k4.dmu);
    dr += (ds / 6) * (k1.ddr + 2 * k2.ddr + 2 * k3.ddr + k4.ddr);
    dmu += (ds / 6) * (k1.ddmu + 2 * k2.ddmu + 2 * k3.ddmu + k4.ddmu);
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
    let polar = polarPotential(mu, ray, a);
    if (polar < 0) {
      mu = reflect(mu, polar, 2 * mu * (a * a - ray.xi ** 2 - ray.eta) - 4 * a * a * mu ** 3);
      dmu = -dmu;
      polar = Math.max(polarPotential(mu, ray, a), 0);
    }
    dmu = (dmu < 0 ? -1 : 1) * Math.sqrt(polar);
  }
  // Still circling when the budget runs out: the shader calls these
  // captured, and they are the near-critical rays that wind forever.
  return { captured: true, sweep: phi - phi0, turningRadius, steps: maxSteps };
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
    expect(KERR_GLSL).toContain('a * p / kerrDelta(r, a) + xi / max(1.0 - mu * mu, 1.0e-6) - a');
    expect(GEODESIC_GLSL).toContain('STEP_EPS / max(rate, 1.0e-4)');
    expect(GEODESIC_GLSL).toContain('kerrProject(y + (ds / 6.0)');
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
    expect(worst).toBeGreaterThan(budget / 2);
  });
});
