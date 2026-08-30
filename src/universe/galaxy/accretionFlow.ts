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
import { C_LIGHT, PROTON_MASS, SIGMA_SB, THOMSON_CROSS_SECTION } from '../../core/physics/constants';

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
  /**
   * The coefficient of the flow's thickness law, which is H/R at the
   * inner edge before the taper. Read it through flowAspectAt rather
   * than on its own — for a disc it is not the aspect ratio anywhere,
   * because H/R varies across the flow.
   */
  heightCoefficient: number;
  /**
   * How H/R falls with radius: H/R = coefficient (r_in/r)^this.
   *
   * Zero for a torus, which is held open by its own trapped heat and
   * so keeps a fixed opening angle at every radius. One for a disc,
   * where the support is the radiation pressure of the flux passing
   * through it — and since that flux and the vertical gravity carry
   * the same r^-3, H comes out the *same* at every radius and H/R
   * falls as 1/r.
   */
  heightExponent: number;
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

/** Shakura–Sunyaev viscosity. Everything a hot flow does on its own
 *  timescale — how fast it drifts inward, and so how much of it is in
 *  the way at any moment — carries this, and simulations and fitted
 *  discs both put it near a tenth. */
const VISCOSITY_ALPHA = 0.1;
/**
 * How far open an ion torus stands. A flow that cannot radiate what it
 * gains keeps the heat, and the sound speed comes up to within a factor
 * of the orbital speed — H/R = c_s/v_K is then of order a half, at
 * every radius alike, which is what simulations of hot flows settle to.
 */
const RIAF_ASPECT = 0.55;

/**
 * How much of the light behind a hot flow gets through it.
 *
 * A radiatively inefficient flow is optically thin — that is half of
 * what makes it look like anything at all — but *how* thin depends
 * entirely on how much is being fed into it, and a fixed value gets
 * that badly wrong at both ends. A hole starving at a millionth of
 * Eddington was drawing the same veil across its own shadow as one
 * feeding a thousand times harder.
 *
 * The column follows from the supply and nothing else. Steady inflow
 * puts Ṁ = 2πRΣv_r through every radius; a thick flow drifts inward at
 * v_r = α v_K (H/R)²; and electron scattering gives every kilogram of
 * it the same cross-section. So Σ = Ṁ/(2πR v_r) and τ = κΣ/2, with
 * κ = σ_T/m_p. No free parameter beyond α.
 *
 * The result is anchored at both ends of the model's own range. At the
 * percent of Eddington where the flow stops being radiatively
 * inefficient, τ comes out near two — the flow turns optically thick
 * exactly where it turns into a disc, which is not something put in.
 * Three decades further down, where most galactic centres actually
 * sit, τ is three percent: a hot torus you can see the far side of,
 * and the sky behind it.
 */
function riafOpacity(
  massSolar: number,
  rateKgPerS: number,
  innerRadiusRg: number,
  aspectRatio: number,
): number {
  const rMetres = innerRadiusRg * gravitationalRadius(massSolar);
  // v_r = α v_K (H/R)², with v_K = c/√(r/r_g).
  const inflow =
    VISCOSITY_ALPHA * (C_LIGHT / Math.sqrt(innerRadiusRg)) * aspectRatio * aspectRatio;
  const surfaceDensity = rateKgPerS / (2 * Math.PI * rMetres * inflow);
  const tau = 0.5 * (THOMSON_CROSS_SECTION / PROTON_MASS) * surfaceDensity;
  return 1 - Math.exp(-tau);
}

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
      // Vertical hydrostatic support against Ω²z, with the pressure
      // supplied by the radiation on its way out: (κ/c)F = Ω²H, and
      // F = 3GMṀ(1 − √(r_in/r))/8πr³ carries the same r^-3 as Ω², so
      // the radius cancels outright and
      //
      //   H = (3/2)(ṁ/η) r_g (1 − √(r_in/r))
      //
      // — one height for the whole disc, set by nothing but how hard
      // it is being fed. That is why a quasar is not a sheet: at a
      // third of Eddington this reaches a fifth of the radius a couple
      // of gravitational radii out, and only becomes thin further out
      // because r grows and H does not.
      heightCoefficient: (1.5 * eddingtonRatio) / (efficiency * iscoRg),
      heightExponent: 1,
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
  //
  // It also does not radiate what it is given. Its efficiency falls in
  // step with its supply — η = η₀ ṁ/ṁ_crit, which is the same relation
  // that makes L go as the square of the rate — so the same light is
  // bought with far more gas than a disc would need: five decades down,
  // fifty times more. That rate is not a detail. It is what decides how
  // much of the flow is in the way of everything behind it, and it is
  // what η here has to mean if L = ηṀc² is to stay true.
  const supplyEddington = Math.sqrt(THIN_DISC_THRESHOLD * eddingtonRatio);
  const hotEfficiency = efficiency * (supplyEddington / THIN_DISC_THRESHOLD);
  const hotRateKgPerS = accretionRate(luminosityW, hotEfficiency);
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
    efficiency: hotEfficiency,
    rateKgPerS: hotRateKgPerS,
    regime: 'riaf',
    innerRadiusRg,
    outerRadiusRg,
    innerTemperatureK,
    profileExponent,
    edgeTaper: 0,
    heightCoefficient: RIAF_ASPECT,
    heightExponent: 0,
    opacity: riafOpacity(massSolar, hotRateKgPerS, innerRadiusRg, RIAF_ASPECT),
    // Σ = Ṁ/(2πR v_r) with v_r ∝ R^−½: the column thins as the square
    // root of the radius, which is far slower than the emission does.
    opacityExponent: 0.5,
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

/**
 * The flow's half-thickness over its cylindrical radius, where the ray
 * actually is.
 *
 * A torus keeps the same opening angle everywhere. A disc does not: its
 * H is very nearly one height for the whole disc, so H/R falls as 1/r
 * and the flow is a flared bowl near the middle and a sheet further
 * out. No single number describes that, which is why the coefficient
 * and the law are carried separately and read through here.
 */
export function flowAspectAt(flow: AccretionFlow, radiusRg: number): number {
  const r = Math.max(radiusRg, 1e-6);
  const taper =
    flow.edgeTaper > 0 ? Math.max(0, 1 - Math.sqrt(flow.innerRadiusRg / r)) : 1;
  return flow.heightCoefficient * (r / flow.innerRadiusRg) ** -flow.heightExponent * taper;
}
