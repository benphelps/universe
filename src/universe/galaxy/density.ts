/**
 * Analytic stellar density model of the galaxy, stars per cubic parsec,
 * in galactocentric cartesian coordinates (parsecs, z out of the disk).
 * Components: double-exponential thin and thick disks, a power-law halo,
 * and logarithmic spiral arms as a multiplicative enhancement. The
 * normalization anchors the solar-neighborhood value ≈ 0.1 stars/pc³.
 */

export interface GalacticPosition {
  xPc: number;
  yPc: number;
  zPc: number;
}

/** The home locale: solar galactocentric radius, just above the midplane. */
export const HOME_POSITION: GalacticPosition = { xPc: 8000, yPc: 0, zPc: 20 };

const THIN_SCALE_LENGTH = 2600;
const THIN_SCALE_HEIGHT = 300;
const THICK_SCALE_LENGTH = 3600;
const THICK_SCALE_HEIGHT = 900;
/** Normalized so thin ≈ 0.09 and thick ≈ 0.01 at the home position. */
const THIN_NORM = 0.09 / (Math.exp(-8000 / THIN_SCALE_LENGTH) * Math.exp(-20 / THIN_SCALE_HEIGHT));
const THICK_NORM =
  0.01 / (Math.exp(-8000 / THICK_SCALE_LENGTH) * Math.exp(-20 / THICK_SCALE_HEIGHT));

const ARM_COUNT = 2;
const ARM_PITCH_TAN = Math.tan((12 * Math.PI) / 180);
const ARM_INNER_RADIUS = 3000;
const SPUR_PITCH_TAN = Math.tan((24 * Math.PI) / 180);
/** Rigorous ceiling on armBoost anywhere: a coincident arm-body peak
 *  and full star-forming knot (seg·(2.6 + 2.6)) plus a full spur,
 *  plus cross-arm tails, with margin. */
export const ARM_BOOST_MAX = 6.1;

function wrapPi(angle: number): number {
  const m = (angle + Math.PI) % (2 * Math.PI);
  return (m < 0 ? m + 2 * Math.PI : m) - Math.PI;
}

function smooth01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** Azimuthal wobble of arm k's ridge at winding phase u: real arms are
 *  not perfect log spirals. Fixed sinusoid sums (not gradient noise) so
 *  the volume shader reproduces the exact same galaxy. */
function armWobble(u: number, arm: number): number {
  return (
    0.16 * Math.sin(1.1 * u + 1.3 + 2.1 * arm) + 0.07 * Math.sin(2.6 * u + 4.2 + 1.7 * arm)
  );
}

/**
 * The spiral structure at one disk point: the stellar enhancement and
 * the dust-lane weight. Each arm's ridge wobbles off the log spiral in
 * sweeping bends (the second arm not quite π away — spirals are never
 * point-symmetric), its width breathes, and its amplitude runs in slow
 * bright segments studded with compact star-forming knots at half the
 * body's width — arm 0 stronger than arm 1. A family of five short
 * steeper-pitch spurs feathers the space between, and everything
 * emerges smoothly out of the bulge region. The dust lane hugs each
 * arm's inner edge. Mirrored line for line by the galaxy-volume shader.
 */
export function armProfile(
  radiusPc: number,
  azimuthRad: number,
): { boost: number; lane: number } {
  const emerge = smooth01((radiusPc - 2900) / 1700);
  if (emerge <= 0) return { boost: 0, lane: 0 };
  const u = Math.log(Math.max(radiusPc, ARM_INNER_RADIUS) / ARM_INNER_RADIUS) / ARM_PITCH_TAN;
  let boost = 0;
  let lane = 0;
  for (let arm = 0; arm < ARM_COUNT; arm++) {
    const ridge = u + arm * (Math.PI + 0.22) + armWobble(u, arm);
    const d = Math.abs(wrapPi(azimuthRad - ridge)) * radiusPc;
    const width = 600 * (1 + 0.25 * Math.sin(2.3 * u + 0.8 + 2.9 * arm));
    const seg =
      0.35 + 0.65 * (0.5 + 0.5 * Math.sin(1.9 * u + 5.1 + 2.45 * arm)) ** 1.3;
    const knot = Math.max(
      0,
      Math.sin(9.0 * u + 1.0 + 3.7 * arm) * Math.sin(5.7 * u + 0.9 + 2.0 * arm),
    );
    const body = d / width;
    const core = d / (0.5 * width);
    boost +=
      (arm === 0 ? 1 : 0.78) *
      seg *
      (2.6 * Math.exp(-body * body) + 2.6 * knot * knot * Math.exp(-core * core));
    const laneD = Math.abs(wrapPi(azimuthRad - (ridge - 0.05))) * radiusPc;
    lane += (0.4 + 0.6 * seg) * Math.exp(-((laneD / 300) ** 2));
  }
  const v = Math.log(Math.max(radiusPc, ARM_INNER_RADIUS) / ARM_INNER_RADIUS) / SPUR_PITCH_TAN;
  for (let j = 0; j < 5; j++) {
    const d = Math.abs(wrapPi(azimuthRad - (v + (j * 2 * Math.PI) / 5 + 0.9))) * radiusPc;
    const gate = Math.max(0, Math.sin(2.6 * v + 2.4 * j + 0.6));
    boost += 0.65 * gate * gate * Math.exp(-((d / 420) ** 2));
  }
  return { boost: boost * emerge, lane: lane * emerge };
}

/** Spiral-arm density enhancement factor (1 between arms, up to
 *  ~ARM_BOOST_MAX in a star-forming bead). */
export function armBoost(radiusPc: number, azimuthRad: number): number {
  return 1 + armProfile(radiusPc, azimuthRad).boost;
}

/** Which spiral arm a locale is closest to, and how far off its
 *  (wobbled) ridge — the same centerline the density rides. */
export function nearestArm(
  radiusPc: number,
  azimuthRad: number,
): { index: number; distancePc: number } {
  const u = Math.log(Math.max(radiusPc, ARM_INNER_RADIUS) / ARM_INNER_RADIUS) / ARM_PITCH_TAN;
  let index = 0;
  let nearest = Infinity;
  for (let arm = 0; arm < ARM_COUNT; arm++) {
    const ridge = u + arm * (Math.PI + 0.22) + armWobble(u, arm);
    const distance = Math.abs(wrapPi(azimuthRad - ridge)) * radiusPc;
    if (distance < nearest) {
      nearest = distance;
      index = arm;
    }
  }
  return { index, distancePc: nearest };
}

export interface ComponentDensities {
  thin: number;
  thick: number;
  halo: number;
}

export interface SightlineDensities extends ComponentDensities {
  dust: number;
  armBoost: number;
}

/**
 * One sightline sample of the smooth model: every component from a
 * single arm-profile evaluation. This is the hot path of the sky and
 * volume integrations, and the single source the piecewise accessors
 * below read — so the fused and separate views can never drift.
 */
export function sightlineDensities(position: GalacticPosition): SightlineDensities {
  const radius = Math.hypot(position.xPc, position.yPc);
  const azimuth = Math.atan2(position.yPc, position.xPc);
  const absZ = Math.abs(position.zPc);
  const { boost, lane } = armProfile(radius, azimuth);

  const thin =
    THIN_NORM *
    Math.exp(-radius / THIN_SCALE_LENGTH) *
    Math.exp(-absZ / THIN_SCALE_HEIGHT) *
    (1 + boost);
  const thick =
    THICK_NORM * Math.exp(-radius / THICK_SCALE_LENGTH) * Math.exp(-absZ / THICK_SCALE_HEIGHT);
  const sphericalR = Math.max(Math.hypot(radius, absZ), 500);
  const halo = 0.0008 * (sphericalR / 8000) ** -3.5;
  const dust = Math.exp(-radius / 2600) * Math.exp(-absZ / 120) * (1 + 1.4 * lane);

  return { thin, thick, halo, dust, armBoost: 1 + boost };
}

/** Per-component stellar densities, stars per pc³. */
export function componentDensities(position: GalacticPosition): ComponentDensities {
  const { thin, thick, halo } = sightlineDensities(position);
  return { thin, thick, halo };
}

/** Total stellar density, stars per pc³. */
export function stellarDensity(position: GalacticPosition): number {
  const { thin, thick, halo } = sightlineDensities(position);
  return thin + thick + halo;
}

/**
 * Upper bound on stellar density anywhere inside an axis-aligned cell:
 * every component decreases with cylindrical radius and |z|, so the
 * bound evaluates at the cell point nearest the galactic center and
 * midplane, with the arm enhancement at its maximum. Catalog cells
 * thin against this ceiling, so looseness costs candidates, never stars.
 */
export function stellarDensityCeiling(minCorner: GalacticPosition, sizePc: number): number {
  const nearest = (lo: number): number => Math.min(Math.max(0, lo), lo + sizePc);
  const radius = Math.hypot(nearest(minCorner.xPc), nearest(minCorner.yPc));
  const absZ = Math.abs(nearest(minCorner.zPc));
  const thin =
    THIN_NORM *
    Math.exp(-radius / THIN_SCALE_LENGTH) *
    Math.exp(-absZ / THIN_SCALE_HEIGHT) *
    ARM_BOOST_MAX;
  const thick =
    THICK_NORM * Math.exp(-radius / THICK_SCALE_LENGTH) * Math.exp(-absZ / THICK_SCALE_HEIGHT);
  const sphericalR = Math.max(Math.hypot(radius, absZ), 500);
  return thin + thick + 0.0008 * (sphericalR / 8000) ** -3.5;
}

/** Dust density for extinction: a thin midplane layer with narrow
 *  lanes hugging the spiral arms' inner edges. */
export function dustDensity(position: GalacticPosition): number {
  return sightlineDensities(position).dust;
}
