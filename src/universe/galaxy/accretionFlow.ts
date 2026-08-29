import {
  accretionRate,
  discPeakRadiusRg,
  discTemperature,
  eddingtonLuminosity,
  gravitationalRadius,
  horizonRadiusRg,
  iscoRadiusRg,
  radiativeEfficiency,
  selfGravityRadiusRg,
} from '../../core/physics/blackHole';
import { SIGMA_SB } from '../../core/physics/constants';

/**
 * What a black hole is eating, and what that makes of it.
 *
 * The flow has two regimes, and which one a galaxy shows is the single
 * largest fact about how its centre looks. Above roughly a percent of
 * Eddington, gas cools faster than it inflows and settles into a
 * geometrically thin, optically thick Shakura-Sunyaev disc - a quasar.
 * Below it the gas cannot radiate what it gains, puffs into a hot ion
 * torus and limps along radiatively inefficient. Most galaxies are down
 * in that quiet regime: the hole is starving, and what little there is
 * to see is a thin ring of plasma around a shadow.
 */

export type FlowRegime = 'thin-disc' | 'riaf';

export interface AccretionFlow {
  regime: FlowRegime;
  /** L/L_Edd. */
  eddingtonRatio: number;
  luminosityW: number;
  /** Ṁ, kg/s. */
  rateKgPerS: number;
  /** η = 1 − E(r_ISCO). */
  efficiency: number;
  /** Inner edge of the emitting flow, r_g. */
  innerRadiusRg: number;
  /** Outer edge, r_g — self-gravity for a disc, the hot flow's own
   *  extent for a RIAF. */
  outerRadiusRg: number;
  /** Effective temperature at the inner edge, K: the profile's anchor. */
  innerTemperatureK: number;
  /** T(r) falls as (r/r_in)^−exponent outside the inner edge. */
  profileExponent: number;
  /** 1 applies the torque-free (1 − √(r_in/r))^¼ edge of a thin disc;
   *  0 is a flow that plunges straight through. */
  edgeTaper: number;
  /** Vertical half-thickness over radius: razor-thin disc vs ion torus. */
  aspectRatio: number;
  /** Optical depth through the flow — 1 hides what is behind it, a
   *  RIAF lets the far side show through. */
  opacity: number;
  /** Log-normal width of the flow's density fluctuations. The
   *  magnetorotational instability is what makes accretion happen at
   *  all — without it a disc has no way to shed angular momentum — and
   *  it leaves the gas clumped, not smooth. Simulations measure the
   *  density distribution it produces as log-normal with this width;
   *  a thick flow, turbulent through its whole depth, sits at the top
   *  of the observed range and a thin one nearer the bottom. */
  turbulenceSigma: number;
  /** How fast that opacity thins outward: (r/r_in)^−exponent. A cold
   *  disc stays opaque to its outer edge; a hot flow's column falls
   *  away with its density and its outskirts are all but invisible. */
  opacityExponent: number;
}

/** Where the flow changes character: below this the gas cannot cool. */
const THIN_DISC_THRESHOLD = 0.01;

/**
 * The flow a hole of this mass and spin settles into at this feeding
 * rate. Pure: mass, spin and one dimensionless number decide the whole
 * structure.
 */
export function accretionFlowFor(
  massSolar: number,
  spin: number,
  eddingtonRatio: number,
): AccretionFlow {
  const efficiency = radiativeEfficiency(spin);
  const iscoRg = iscoRadiusRg(spin);
  const luminosityW = eddingtonRatio * eddingtonLuminosity(massSolar);
  const rateKgPerS = accretionRate(luminosityW, efficiency);
  const common = { eddingtonRatio, luminosityW, rateKgPerS, efficiency };

  if (eddingtonRatio >= THIN_DISC_THRESHOLD) {
    // Shakura-Sunyaev: the disc reaches from the last stable orbit out
    // to where its own gravity fragments it, and its temperature is
    // whatever the dissipated orbital energy makes it.
    const outerRadiusRg = Math.max(
      50,
      selfGravityRadiusRg(massSolar, eddingtonRatio),
    );
    const peak = discTemperature(
      discPeakRadiusRg(iscoRg),
      iscoRg,
      massSolar,
      rateKgPerS,
    );
    // Anchor the shader's T(r) = T_in (r/r_in)^−¾ (1 − √(r_in/r))^¼ so
    // it reproduces the profile exactly: the taper puts the true peak
    // at (49/36) r_in with value (36/49)^¾ (1 − 6/7)^¼ T_in.
    const innerTemperatureK = peak / ((36 / 49) ** 0.75 * (1 / 7) ** 0.25);
    return {
      ...common,
      regime: 'thin-disc',
      innerRadiusRg: iscoRg,
      outerRadiusRg,
      innerTemperatureK,
      profileExponent: 0.75,
      edgeTaper: 1,
      // Radiation pressure puffs the inner disc a little; it is still
      // effectively a sheet, and an opaque one.
      aspectRatio: 0.02 + 0.06 * Math.min(1, eddingtonRatio),
      // Opaque at the inner edge and thinning outward: the column a
      // ray has to see through is the disc's surface density, and that
      // falls away with radius. Only the innermost disc is a surface;
      // past a few inner radii it is gas you can see into, and the
      // clumping decides which lanes are shut and which are open.
      opacity: 1,
      opacityExponent: 1,
      turbulenceSigma: 0.5,
    };
  }

  // Radiatively inefficient flow: a hot, thick, optically thin torus
  // that reaches inside the last stable orbit and plunges. Its
  // emission is centrally concentrated and its brightness temperature
  // is simply the luminosity spread over the emitting surface.
  const innerRadiusRg = horizonRadiusRg(spin);
  const outerRadiusRg = 60;
  const profileExponent = 1;
  const innerTemperatureK = riafInnerTemperature(
    massSolar,
    luminosityW,
    innerRadiusRg,
    outerRadiusRg,
    profileExponent,
  );
  return {
    ...common,
    regime: 'riaf',
    innerRadiusRg,
    outerRadiusRg,
    innerTemperatureK,
    profileExponent,
    edgeTaper: 0,
    aspectRatio: 0.55,
    opacity: 0.45,
    opacityExponent: 1.5,
    turbulenceSigma: 0.9,
  };
}

/**
 * Brightness temperature at the inner edge of a hot flow: the one
 * value for which ∫ 2σT⁴ 2πr dr over the torus equals the luminosity
 * the accretion rate produces. The flow radiates synchrotron, not a
 * Planck spectrum, so this is a brightness temperature standing in for
 * the real one — it carries the right total power out of the right
 * area, which is what an image needs.
 */
function riafInnerTemperature(
  massSolar: number,
  luminosityW: number,
  innerRg: number,
  outerRg: number,
  exponent: number,
): number {
  const rg = gravitationalRadius(massSolar);
  const p = 4 * exponent;
  // ∫ r^(1−p) dr from r_in to r_out, in r_g.
  const integral =
    p === 2
      ? Math.log(outerRg / innerRg)
      : (outerRg ** (2 - p) - innerRg ** (2 - p)) / (2 - p);
  const area = 4 * Math.PI * rg * rg * innerRg ** p * integral;
  return (luminosityW / (SIGMA_SB * area)) ** 0.25;
}

/** Effective temperature of the flow at radius r (r_g), kelvin. */
export function flowTemperature(flow: AccretionFlow, radiusRg: number): number {
  if (radiusRg < flow.innerRadiusRg || radiusRg > flow.outerRadiusRg) return 0;
  const taper =
    flow.edgeTaper > 0
      ? Math.max(0, 1 - Math.sqrt(flow.innerRadiusRg / radiusRg)) ** 0.25
      : 1;
  return (
    flow.innerTemperatureK * (radiusRg / flow.innerRadiusRg) ** -flow.profileExponent * taper
  );
}
