import { clampSpin } from './blackHole';

/**
 * Null geodesics in the Kerr metric, in the separated form Carter
 * found: with the constant that bears his name, the radial and polar
 * motions decouple and each becomes a one-dimensional problem in its
 * own potential. Lengths are gravitational radii (M = 1) and the
 * affine parameter is Mino time σ, related to the usual one by
 * dλ = Σ dσ — the substitution that performs the separation.
 *
 * A photon is then fully described by two numbers: ξ = L_z/E, its
 * angular momentum about the spin axis, and η = Q/E², Carter's
 * constant. Everything below is exact; the only approximation in the
 * renderer that reads it is the size of the steps it takes.
 */

/** Boyer–Lindquist Σ = r² + a²cos²θ. */
export function sigma(r: number, mu: number, spin: number): number {
  return r * r + spin * spin * mu * mu;
}

/** Δ = r² − 2r + a². Vanishes at the horizons. */
export function delta(r: number, spin: number): number {
  return r * r - 2 * r + spin * spin;
}

/** A = (r² + a²)² − a²Δsin²θ, the frame-dragging denominator. */
export function bigA(r: number, mu: number, spin: number): number {
  const rr = r * r + spin * spin;
  return rr * rr - spin * spin * delta(r, spin) * (1 - mu * mu);
}

/** Angular velocity a locally non-rotating observer is dragged at. */
export function frameDragging(r: number, mu: number, spin: number): number {
  return (2 * spin * r) / bigA(r, mu, spin);
}

/** Lapse of the locally non-rotating frame: √(ΣΔ/A). */
export function lapse(r: number, mu: number, spin: number): number {
  return Math.sqrt((sigma(r, mu, spin) * delta(r, spin)) / bigA(r, mu, spin));
}

/** The two constants that describe a photon, and where it starts. */
export interface PhotonRay {
  /** ξ = L_z/E, angular momentum about the spin axis. */
  xi: number;
  /** η = Q/E², Carter's constant. */
  eta: number;
  /** dr/dσ at the starting point. */
  dr: number;
  /** dμ/dσ at the starting point, μ = cos θ. */
  dmu: number;
}

/**
 * The photon arriving at an observer from a given direction on its sky.
 *
 * This is the step the approximate treatments get wrong. A ray is a
 * direction in someone's local frame, and turning it into ξ and η means
 * carrying it through the tetrad of an actual observer — here the
 * locally non-rotating one, which exists everywhere outside the horizon
 * and whose axes are the natural ones to call radial, polar and
 * azimuthal. Flat-space expressions for the same conversion are right
 * only infinitely far away, and near a spinning hole they are not close.
 *
 * `n` is the direction the photon travels, in that frame: outward,
 * southward and prograde components, unit length. The observer's own
 * dragging is already inside the tetrad, so no correction is applied on
 * top of it.
 */
export function photonFromDirection(
  r: number,
  mu: number,
  spin: number,
  n: readonly [number, number, number],
): PhotonRay {
  const a = clampSpin(spin);
  const sig = sigma(r, mu, a);
  const del = delta(r, a);
  const A = bigA(r, mu, a);
  const sinTheta = Math.sqrt(Math.max(1 - mu * mu, 1e-12));
  const alpha = lapse(r, mu, a);
  const omega = frameDragging(r, mu, a);

  // Coordinate components of the momentum, from the tetrad legs
  // e_(t) = (∂_t + ω∂_φ)/α, e_(r) = √(Δ/Σ)∂_r,
  // e_(θ) = ∂_θ/√Σ, e_(φ) = √(Σ/A)∂_φ/sinθ. Energy is carried as 1 in
  // the local frame and divided out at the end.
  const pt = 1 / alpha;
  const pr = Math.sqrt(del / sig) * n[0];
  const ptheta = n[1] / Math.sqrt(sig);
  const pphi = omega / alpha + (Math.sqrt(sig / A) * n[2]) / sinTheta;

  // Lowered, through the metric, to reach the conserved quantities.
  const gtt = -(1 - (2 * r) / sig);
  const gtphi = (-2 * a * r * sinTheta * sinTheta) / sig;
  const gphiphi = ((A / sig) * sinTheta * sinTheta);
  const energy = -(gtt * pt + gtphi * pphi);
  const angular = gtphi * pt + gphiphi * pphi;

  const xi = angular / energy;
  // p_θ = Σ p^θ; Carter's constant for a null geodesic.
  const pThetaLower = (sig * ptheta) / energy;
  const eta = pThetaLower * pThetaLower + mu * mu * (xi * xi / (sinTheta * sinTheta) - a * a);

  // dr/dλ = p^r and dμ/dλ = −sinθ p^θ; Mino time divides out Σ.
  return {
    xi,
    eta,
    dr: (sig * pr) / energy,
    dmu: (-sinTheta * sig * ptheta) / energy,
  };
}

/** R(r) = P² − ΔK: the radial potential, whose square root is dr/dσ. */
export function radialPotential(r: number, ray: PhotonRay, spin: number): number {
  const a = clampSpin(spin);
  const p = r * r + a * a - a * ray.xi;
  const k = (ray.xi - a) * (ray.xi - a) + ray.eta;
  return p * p - delta(r, a) * k;
}

/** Θ(μ) = η + μ²(a² − ξ² − η) − a²μ⁴, the polar potential. */
export function polarPotential(mu: number, ray: PhotonRay, spin: number): number {
  const a = clampSpin(spin);
  const m2 = mu * mu;
  return ray.eta + m2 * (a * a - ray.xi * ray.xi - ray.eta) - a * a * m2 * m2;
}

/**
 * Where the shadow's edge comes from: the photons that neither escape
 * nor fall, circling forever on spherical orbits of radius r. Bardeen's
 * closed form for the constants of those orbits — sweep r across the
 * range they occupy and this traces the critical curve exactly.
 */
export function criticalConstants(r: number, spin: number): { xi: number; eta: number } {
  const a = clampSpin(spin);
  const denom = a * (r - 1);
  if (Math.abs(denom) < 1e-9) {
    // The static limit: the curve is the circle of radius 3√3.
    return { xi: 0, eta: 27 };
  }
  const xi = (r * r * (3 - r) - a * a * (1 + r)) / denom;
  const eta = (r * r * r * (4 * a * a - r * (r - 3) * (r - 3))) / (denom * denom);
  return { xi, eta };
}

/** The spherical photon orbits run between the two equatorial ones. */
function photonOrbitRange(spin: number): [number, number] {
  return [
    2 * (1 + Math.cos((2 / 3) * Math.acos(-spin))),
    2 * (1 + Math.cos((2 / 3) * Math.acos(spin))),
  ];
}

/**
 * Shadow radius seen straight down the spin axis, r_g. Every photon
 * reaching a point on the axis has zero angular momentum about it, so
 * only the one spherical orbit with ξ = 0 marks the edge, and the
 * shadow is the circle √(η + a²) around it. Symmetry makes it a true
 * circle at any spin — but not the same circle: 5.196 for a static
 * hole, shrinking to 4.83 at the Thorne limit.
 */
export function polarShadowRadius(spin: number): number {
  const a = clampSpin(spin);
  if (Math.abs(a) < 1e-8) return 3 * Math.sqrt(3);
  let [lo, hi] = photonOrbitRange(a);
  // ξ runs monotonically from prograde to retrograde across the range.
  const sign = Math.sign(criticalConstants(lo, a).xi);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(criticalConstants(mid, a).xi) === sign) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(criticalConstants((lo + hi) / 2, a).eta + a * a);
}

/**
 * The shadow's outline on the sky of a distant observer looking from
 * the given inclination, in gravitational radii of impact parameter.
 * Bardeen's α and β: α across the spin axis, β along it. For a static
 * hole it closes into the circle of radius 3√3; spin drags the
 * prograde side in and pushes the retrograde side out, flattening it
 * on one edge into the D the Event Horizon Telescope went looking for.
 */
export function shadowOutline(
  spin: number,
  inclinationRad: number,
  samples = 256,
): Array<[number, number]> {
  const a = clampSpin(spin);
  const sinI = Math.sin(inclinationRad);
  const cosI = Math.cos(inclinationRad);
  const points: Array<[number, number]> = [];

  // On the axis the α = −ξ/sinθ parameterization has nothing to say —
  // the whole visible curve collapses to ξ = 0 — so the circle that
  // limit converges to is drawn directly.
  if (Math.abs(sinI) < 1e-4) {
    const radius = polarShadowRadius(a);
    for (let i = 0; i <= samples; i++) {
      const psi = (2 * Math.PI * i) / samples;
      points.push([radius * Math.cos(psi), radius * Math.sin(psi)]);
    }
    return points;
  }

  const [inner, outer] = photonOrbitRange(a);
  const upper: Array<[number, number]> = [];
  for (let i = 0; i <= samples; i++) {
    const r = inner + ((outer - inner) * i) / samples;
    const { xi, eta } = criticalConstants(r, a);
    const betaSq = eta + cosI * cosI * (a * a - (xi * xi) / (sinI * sinI));
    if (betaSq < 0) continue;
    upper.push([-xi / sinI, Math.sqrt(betaSq)]);
  }
  for (const p of upper) points.push(p);
  for (let i = upper.length - 1; i >= 0; i--) points.push([upper[i][0], -upper[i][1]]);
  return points;
}

/** Angular velocity of an equatorial circular geodesic, prograde. */
export function orbitAngularVelocity(r: number, spin: number): number {
  return 1 / (r ** 1.5 + clampSpin(spin));
}

/**
 * Time component of a circular orbiter's four-velocity — the factor by
 * which its clock runs slow against a distant one. Diverges at the
 * photon orbit, where no matter can hold a circle.
 */
export function orbitTimeDilation(r: number, spin: number): number {
  const a = clampSpin(spin);
  const root = r * r * r - 3 * r * r + 2 * a * r ** 1.5;
  return (r ** 1.5 + a) / Math.sqrt(Math.max(root, 1e-9));
}
