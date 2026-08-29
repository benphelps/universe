import { describe, expect, it } from 'vitest';
import { horizonRadiusRg, iscoRadiusRg, photonSphereRadiusRg } from './blackHole';
import {
  criticalConstants,
  delta,
  flowFourVelocity,
  orbitAngularVelocity,
  orbitTimeDilation,
  photonFromDirection,
  polarPotential,
  radialPotential,
  type PhotonRay,
  polarShadowRadius,
  shadowOutline,
} from './kerr';

/** A unit direction in the local frame from two sky angles. */
function direction(outward: number, south: number, prograde: number): [number, number, number] {
  const n = Math.hypot(outward, south, prograde);
  return [outward / n, south / n, prograde / n];
}

describe('photon constants from an observer tetrad', () => {
  // The test the flat-space shortcut fails. Whatever direction a photon
  // arrives from, the constants read off the tetrad must satisfy the
  // very potentials that will then propagate it — otherwise the ray
  // starts off its own geodesic and every later step compounds it.
  const cases: Array<[number, number, number]> = [
    [8, 0.0, 0.3],
    [8, 0.4, -0.9],
    [15, -0.6, 0.5],
    [30, 0.2, 0.0],
    [6, 0.9, 0.7],
  ];

  for (const spin of [0, 0.5, 0.9, 0.998, -0.7]) {
    for (const [r, mu, prograde] of cases) {
      it(`satisfies both potentials at a=${spin}, r=${r}, mu=${mu}`, () => {
        const n = direction(-0.8, 0.35, prograde);
        const ray = photonFromDirection(r, mu, spin, n);

        expect(radialPotential(r, ray, spin)).toBeCloseTo(ray.dr * ray.dr, 6);
        expect(polarPotential(mu, ray, spin)).toBeCloseTo(ray.dmu * ray.dmu, 6);
      });
    }
  }

  it('recovers the impact parameter far from a static hole', () => {
    // At large r a ray aimed slightly off centre has b = √(ξ² + η),
    // and b is the perpendicular offset of its line from the hole.
    const r = 4000;
    const sinAngle = 0.001;
    const n = direction(-Math.sqrt(1 - sinAngle * sinAngle), 0, sinAngle);
    const ray = photonFromDirection(r, 0, 0, n);
    const b = Math.sqrt(ray.xi * ray.xi + ray.eta);
    expect(b).toBeCloseTo(r * sinAngle, 1);
  });

  it('carries no angular momentum on a purely radial ray', () => {
    const ray = photonFromDirection(20, 0, 0.9, [-1, 0, 0]);
    expect(ray.xi).toBeCloseTo(0, 9);
    expect(ray.eta).toBeCloseTo(0, 9);
  });

  it('gives a head-on photon no angular momentum, however fast the hole spins', () => {
    // Not a triviality but the defining property of the frame: the
    // observer rotates at exactly the rate that makes its own radial
    // direction carry zero L_z. Getting this back out confirms the
    // tetrad really is the locally non-rotating one and not a static
    // observer wearing its name.
    for (const spin of [0, 0.5, 0.998]) {
      expect(photonFromDirection(6, 0, spin, [-1, 0, 0]).xi).toBeCloseTo(0, 12);
    }
  });

  it('drags a zero-angular-momentum photon around the hole anyway', () => {
    // Where the dragging actually shows: ξ = 0 does not mean the
    // photon falls straight in. dφ/dσ = aP/Δ − a stays non-zero, and
    // it turns the way the hole turns.
    const ray = photonFromDirection(6, 0, 0.998, [-1, 0, 0]);
    const a = 0.998;
    const r = 4;
    const p = r * r + a * a - a * ray.xi;
    expect((a * p) / delta(r, a) - a).toBeGreaterThan(0.5);
  });
});

describe('the critical curve', () => {
  it('closes on 3√3 for a static hole', () => {
    const { xi, eta } = criticalConstants(3, 1e-12);
    expect(xi).toBeCloseTo(0, 6);
    expect(Math.sqrt(xi * xi + eta)).toBeCloseTo(3 * Math.sqrt(3), 6);
  });

  it('spans the photon orbits it is built from', () => {
    // At either end of the spherical-orbit range the orbit is
    // equatorial: Carter's constant vanishes there.
    const spin = 0.9;
    const prograde = photonSphereRadiusRg(spin);
    const retrograde = 2 * (1 + Math.cos((2 / 3) * Math.acos(spin)));
    expect(criticalConstants(prograde, spin).eta).toBeCloseTo(0, 6);
    expect(criticalConstants(retrograde, spin).eta).toBeCloseTo(0, 6);
  });
});

describe('the shadow', () => {
  it('is a circle of radius 3√3 with no spin', () => {
    const outline = shadowOutline(1e-9, Math.PI / 2, 64);
    for (const [alpha, beta] of outline) {
      expect(Math.hypot(alpha, beta)).toBeCloseTo(3 * Math.sqrt(3), 4);
    }
  });

  it('flattens into a D at the Thorne limit, seen edge-on', () => {
    // The classic result: a near-extremal hole viewed equatorially has
    // a shadow running from about −2 to +7 gravitational radii, its
    // prograde edge dragged in and cut flat.
    const outline = shadowOutline(0.998, Math.PI / 2, 512);
    const alphas = outline.map(([alpha]) => alpha);
    expect(Math.min(...alphas)).toBeCloseTo(-2.11, 1);
    expect(Math.max(...alphas)).toBeCloseTo(6.99, 1);
  });

  it('stays round when the spin axis points at the observer', () => {
    // Looking down the axis there is no preferred direction on the
    // sky, so the asymmetry vanishes however fast the hole spins —
    // though the circle it settles to is smaller than Schwarzschild's.
    const outline = shadowOutline(0.998, 0, 128);
    const radii = outline.map(([alpha, beta]) => Math.hypot(alpha, beta));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1e-9);
    expect(radii[0]).toBeCloseTo(4.83, 2);
  });

  it('approaches the polar circle as the observer nears the axis', () => {
    // The two branches must agree where they meet, or the shadow would
    // jump as the camera crossed over the pole.
    const polar = polarShadowRadius(0.998);
    const spread = (inclination: number): number => {
      let worst = 0;
      for (const [alpha, beta] of shadowOutline(0.998, inclination, 60000)) {
        worst = Math.max(worst, Math.abs(Math.hypot(alpha, beta) - polar));
      }
      return worst;
    };
    // The gap closes in proportion to the inclination, halving with it
    // all the way down — so the two branches do meet, and the seam is
    // a couple of arcseconds of shadow radius a hundredth of a degree
    // off the axis.
    for (const inclination of [0.016, 0.008, 0.004, 0.002]) {
      expect(spread(inclination) / inclination).toBeCloseTo(2.4, 1);
    }
  });

  it('keeps nearly the same area at every spin', () => {
    // Why the shadow measures mass and not spin: dragging one edge in
    // pushes the other out, and the enclosed area barely moves.
    const area = (spin: number): number => {
      const outline = shadowOutline(spin, Math.PI / 2, 512);
      let sum = 0;
      for (let i = 0; i < outline.length; i++) {
        const [x1, y1] = outline[i];
        const [x2, y2] = outline[(i + 1) % outline.length];
        sum += x1 * y2 - x2 * y1;
      }
      return Math.abs(sum) / 2;
    };
    const still = area(1e-9);
    expect(area(0.998) / still).toBeGreaterThan(0.9);
    expect(area(0.998) / still).toBeLessThan(1.0);
  });
});

describe('circular orbits', () => {
  it('reduces to the Schwarzschild dilation with no spin', () => {
    for (const r of [6, 10, 30]) {
      expect(orbitTimeDilation(r, 0)).toBeCloseTo(1 / Math.sqrt(1 - 3 / r), 9);
    }
  });

  it('diverges at the photon orbit, where no orbit holds', () => {
    const spin = 0.7;
    const photon = photonSphereRadiusRg(spin);
    expect(orbitTimeDilation(photon * 1.001, spin)).toBeGreaterThan(20);
    expect(orbitTimeDilation(iscoRadiusRg(spin), spin)).toBeLessThan(3);
  });

  it('lets matter orbit far faster before it must fall', () => {
    // At a fixed coordinate radius a prograde orbit is actually slower,
    // but that radius is not a distance and the comparison is empty.
    // What matters is that spin lets the disc hold a much tighter
    // circle — 1.24 r_g against 6 — and the innermost orbit of a
    // Thorne-limited hole comes round six times faster than a static
    // one's. That margin is where the extra radiative efficiency and
    // the whole beaming asymmetry come from.
    const still = orbitAngularVelocity(iscoRadiusRg(0), 0);
    const spun = orbitAngularVelocity(iscoRadiusRg(0.998), 0.998);
    expect(spun / still).toBeCloseTo(6.19, 1);
  });
});

describe('what the flow is doing', () => {
  it('holds a circle outside the last stable orbit and falls inside it', () => {
    // The boundary is not imposed. A circular orbit's own energy and
    // angular momentum make the radial term vanish identically, so the
    // same expression describes both sides and the infall switches
    // itself on exactly where orbits stop existing.
    for (const spin of [0, 0.5, 0.9, 0.998]) {
      const isco = iscoRadiusRg(spin);
      for (const r of [isco, isco * 1.5, isco * 4, 50]) {
        expect(flowFourVelocity(r, spin, isco).ur).toBeCloseTo(0, 6);
      }
      for (const f of [0.98, 0.9, 0.75]) {
        const inside = flowFourVelocity(isco * f, spin, isco);
        expect(inside.ur).toBeLessThan(0);
        expect(Number.isFinite(inside.ut)).toBe(true);
      }
    }
  });

  it('falls faster the further inside the boundary it gets', () => {
    const spin = 0.9;
    const isco = iscoRadiusRg(spin);
    const near = flowFourVelocity(isco * 0.95, spin, isco).ur;
    const deep = flowFourVelocity(isco * 0.7, spin, isco).ur;
    expect(deep).toBeLessThan(near);
  });

  it('says no light where the gas could not have emitted any', () => {
    // The received frequency divides by (−p·u), and the renderer needs
    // to know where that stops being positive. It does, in one place
    // and for one reason: within a fraction of a percent of the horizon
    // the gas is dragged round at Ω_H, and a photon carrying more
    // angular momentum than 1/Ω_H would have to leave it with negative
    // energy in its own frame. Nothing emitted it, so nothing arrives —
    // and the renderer has to return darkness there rather than clamp
    // the denominator and turn it into the brightest thing on screen.
    let negatives = 0;
    for (const spin of [0, 0.5, 0.9, 0.998]) {
      const isco = iscoRadiusRg(spin);
      const horizon = horizonRadiusRg(spin);
      for (let i = 0; i <= 60; i++) {
        const r = horizon * 1.001 + (30 - horizon) * (i / 60);
        const u = flowFourVelocity(r, spin, isco);
        for (const xi of [-6, -3, 0, 2, 4]) {
          const ray: PhotonRay = { xi, eta: 0, dr: 0, dmu: 0 };
          const potential = radialPotential(r, ray, spin);
          if (potential < 0) continue;
          const dr = Math.sqrt(potential);
          const shift = u.ut - xi * u.uphi - (dr * u.ur) / delta(r, spin);
          expect(Number.isFinite(shift)).toBe(true);
          if (shift <= 0) {
            negatives++;
            // Only ever within a whisker of the horizon, and only for
            // photons the horizon's own rotation outruns.
            expect(r).toBeLessThan(horizon * 1.01);
            expect(xi * (u.uphi / u.ut)).toBeGreaterThan(1);
          }
        }
      }
    }
    expect(negatives).toBeGreaterThan(0);
  });
});
