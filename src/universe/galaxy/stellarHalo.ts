import { fieldPopulationMoments } from './fieldPopulation';

/** Milky-Way-like smooth stellar halo, distinct from dark matter.
 * Deason et al. 2011: oblate broken-power-law shape; Deason et al. 2019:
 * local mass normalization excluding Sagittarius. The 500 pc core is an
 * explicit inner extrapolation/regularization, outside the tracer fit.
 * All current galaxies share this reference family, as their discs do.
 * See docs/model/galaxies-and-stars.md for calibration limits. */
export const STELLAR_HALO_MODEL = {
  localMassSolarPc3: 6.9e-5,
  referencePc: 8000,
  corePc: 500,
  breakPc: 27000,
  flattening: .6,
  innerSlope: 2.3,
  outerSlope: 4.6,
} as const;

let numberNormalization: number | undefined;
export function stellarHaloNumberNormalization(): number {
  return numberNormalization ??= STELLAR_HALO_MODEL.localMassSolarPc3 / fieldPopulationMoments('halo').massSolar;
}

/** Number density on oblate ellipsoids, in objects/pc³. Includes the
 * same brown dwarfs/remnants as the shared component's mass moment. */
export function stellarHaloDensity(radiusPc: number, absZPc: number): number {
  const m = STELLAR_HALO_MODEL;
  const r = Math.max(m.corePc, Math.hypot(radiusPc, absZPc / m.flattening));
  const inner = Math.min(r, m.breakPc) / m.referencePc;
  return stellarHaloNumberNormalization() * inner ** -m.innerSlope *
    (r <= m.breakPc ? 1 : (r / m.breakPc) ** -m.outerSlope);
}

/** Analytic integral inside ellipsoidal radius, including a finite tail
 * at infinity. Volume element 4πq r²dr carries the flattening Jacobian. */
export function stellarHaloCount(maxEllipsoidalRadiusPc = Infinity): number {
  if (!(maxEllipsoidalRadiusPc > 0)) return 0;
  const m = STELLAR_HALO_MODEL;
  const core = Math.min(m.corePc, maxEllipsoidalRadiusPc);
  let radial = core ** 3 / (3 * m.corePc ** m.innerSlope);
  if (maxEllipsoidalRadiusPc > m.corePc) {
    radial += (Math.min(maxEllipsoidalRadiusPc, m.breakPc) ** (3 - m.innerSlope) -
      m.corePc ** (3 - m.innerSlope)) / (3 - m.innerSlope);
  }
  if (maxEllipsoidalRadiusPc > m.breakPc) {
    radial += m.breakPc ** (3 - m.innerSlope) *
      (1 - (maxEllipsoidalRadiusPc / m.breakPc) ** (3 - m.outerSlope)) / (m.outerSlope - 3);
  }
  return 4 * Math.PI * m.flattening * stellarHaloNumberNormalization() * m.referencePc ** m.innerSlope * radial;
}
