import {
  C_LIGHT,
  G,
  PROTON_MASS,
  SIGMA_SB,
  SOLAR_MASS,
  THOMSON_CROSS_SECTION,
} from './constants';

/**
 * Kerr black-hole geometry and thin-disc accretion, in the standard
 * dimensionless form: lengths in gravitational radii r_g = GM/c², spin
 * as the dimensionless a★ = Jc/GM². Everything here is closed-form
 * general relativity — no free parameters, no fitting — so a hole of a
 * given mass and spin has exactly one shadow, one innermost orbit, and
 * one radiative efficiency.
 */

/** The Thorne limit: photon capture from the disc caps spin-up here. */
export const MAX_SPIN = 0.998;

export function clampSpin(spin: number): number {
  return Math.min(MAX_SPIN, Math.max(-MAX_SPIN, spin));
}

/** Gravitational radius GM/c², metres — the length unit of everything below. */
export function gravitationalRadius(massSolar: number): number {
  return (G * massSolar * SOLAR_MASS) / (C_LIGHT * C_LIGHT);
}

/** Event horizon of a Kerr hole, r_g: r₊ = 1 + √(1 − a★²). Schwarzschild → 2. */
export function horizonRadiusRg(spin: number): number {
  const a = clampSpin(spin);
  return 1 + Math.sqrt(1 - a * a);
}

/**
 * Innermost stable circular orbit (Bardeen, Press & Teukolsky 1972),
 * r_g, equatorial. 6 for a static hole, down to 1.237 at the Thorne
 * limit, out to 9 for a maximally retrograde disc — this radius sets
 * both the inner edge of the disc and how much rest mass the hole can
 * convert to light.
 */
export function iscoRadiusRg(spin: number): number {
  const a = clampSpin(spin);
  const z1 =
    1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const z2 = Math.sqrt(3 * a * a + z1 * z1);
  const branch = Math.sqrt(Math.max(0, (3 - z1) * (3 + z1 + 2 * z2)));
  return 3 + z2 - Math.sign(a) * branch;
}

/**
 * Equatorial photon circular orbit, r_g: r_ph = 2{1 + cos[⅔ arccos(∓a★)]}.
 * 3 for a static hole. Light closer than this cannot orbit at all, and
 * light passing near it winds many times — the photon ring.
 */
export function photonSphereRadiusRg(spin: number): number {
  const a = clampSpin(spin);
  return 2 * (1 + Math.cos((2 / 3) * Math.acos(-a)));
}

/**
 * Radius of the shadow as an impact parameter, r_g: the critical value
 * 3√3 ≈ 5.196 separating rays that escape from rays the hole swallows.
 * Exact for a static hole. Spin flattens the prograde edge into a D,
 * but the mean radius moves by only a few percent at any spin or
 * inclination, so the shadow's *size* is a clean measure of mass alone.
 */
export function shadowImpactParameterRg(): number {
  return 3 * Math.sqrt(3);
}

/** Specific energy of an equatorial circular geodesic at radius r (r_g). */
export function circularOrbitEnergy(radiusRg: number, spin: number): number {
  const a = clampSpin(spin);
  const r = radiusRg;
  const s = Math.sqrt(r);
  return (r * r - 2 * r + a * s) / (r * Math.sqrt(r * r - 3 * r + 2 * a * s));
}

/**
 * Radiative efficiency η = 1 − E(r_ISCO): the fraction of infalling
 * rest mass radiated before the last stable orbit. 5.72% static,
 * 32% at the Thorne limit — the most efficient steady engine in nature.
 */
export function radiativeEfficiency(spin: number): number {
  return 1 - circularOrbitEnergy(iscoRadiusRg(spin), clampSpin(spin));
}

/**
 * Orbital speed of disc material at radius r, as measured by a local
 * static observer, in units of c: v = 1/√(r − 2) for a static hole.
 * Half light speed at the ISCO — the source of the beaming asymmetry.
 */
export function orbitalBeta(radiusRg: number): number {
  return 1 / Math.sqrt(Math.max(radiusRg - 2, 1e-6));
}

/** Eddington luminosity 4πGMm_p c/σ_T, watts: where radiation pressure
 *  on ionized hydrogen balances gravity. */
export function eddingtonLuminosity(massSolar: number): number {
  return (
    (4 * Math.PI * G * massSolar * SOLAR_MASS * PROTON_MASS * C_LIGHT) /
    THOMSON_CROSS_SECTION
  );
}

/** Accretion rate that a flow of efficiency η needs to shine at L, kg/s. */
export function accretionRate(luminosityW: number, efficiency: number): number {
  return luminosityW / (Math.max(efficiency, 1e-6) * C_LIGHT * C_LIGHT);
}

/**
 * Effective temperature of a Shakura–Sunyaev disc at radius r, kelvin:
 * σT⁴ = 3GMṀ(1 − √(r_in/r)) / 8πr³. Viscous dissipation of orbital
 * energy with a torque-free inner boundary — zero at the inner edge,
 * peaking at (49/36)r_in, falling as r^(−3/4) outside.
 */
export function discTemperature(
  radiusRg: number,
  innerRadiusRg: number,
  massSolar: number,
  accretionRateKgS: number,
): number {
  if (radiusRg <= innerRadiusRg) return 0;
  const rg = gravitationalRadius(massSolar);
  const r = radiusRg * rg;
  const flux =
    (3 * G * massSolar * SOLAR_MASS * accretionRateKgS * (1 - Math.sqrt(innerRadiusRg / radiusRg))) /
    (8 * Math.PI * r * r * r);
  return (flux / SIGMA_SB) ** 0.25;
}

/** Where a Shakura–Sunyaev disc is hottest: (49/36)·r_in. */
export function discPeakRadiusRg(innerRadiusRg: number): number {
  return (49 / 36) * innerRadiusRg;
}

/**
 * Radius at which the disc's own gravity overwhelms the hole's tidal
 * field and it fragments into stars, r_g — the physical outer edge of
 * any thin accretion disc. The α-disc Toomre-stability scaling: weakly
 * decreasing with mass, weakly increasing with accretion rate, landing
 * near 2×10³ r_g for a 10⁸ M☉ hole at Eddington.
 */
export function selfGravityRadiusRg(massSolar: number, eddingtonRatio: number): number {
  const m8 = Math.max(massSolar, 1) / 1e8;
  const lambda = Math.max(eddingtonRatio, 1e-9);
  return 2150 * m8 ** -0.52 * lambda ** 0.22;
}

/** Hawking temperature, kelvin — vanishing for anything stellar or
 *  larger, and carried only because the model states it honestly. */
export function hawkingTemperature(massSolar: number): number {
  return 6.169e-8 / Math.max(massSolar, 1e-30);
}
