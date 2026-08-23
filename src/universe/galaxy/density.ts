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

/** Spiral-arm density enhancement factor (1 between arms, up to ~2.2 on-arm). */
export function armBoost(radiusPc: number, azimuthRad: number): number {
  if (radiusPc < ARM_INNER_RADIUS) return 1;
  const armPhase = Math.log(radiusPc / ARM_INNER_RADIUS) / ARM_PITCH_TAN;
  let nearest = Infinity;
  for (let arm = 0; arm < ARM_COUNT; arm++) {
    const armAzimuth = armPhase + (arm * 2 * Math.PI) / ARM_COUNT;
    let delta = (azimuthRad - armAzimuth) % (2 * Math.PI);
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    // Arc distance from the arm ridge.
    nearest = Math.min(nearest, Math.abs(delta) * radiusPc);
  }
  return 1 + 1.2 * Math.exp(-((nearest / 700) ** 2));
}

/** Total stellar density, stars per pc³. */
export function stellarDensity(position: GalacticPosition): number {
  const radius = Math.hypot(position.xPc, position.yPc);
  const azimuth = Math.atan2(position.yPc, position.xPc);
  const absZ = Math.abs(position.zPc);

  const thin =
    THIN_NORM *
    Math.exp(-radius / THIN_SCALE_LENGTH) *
    Math.exp(-absZ / THIN_SCALE_HEIGHT) *
    armBoost(radius, azimuth);
  const thick =
    THICK_NORM * Math.exp(-radius / THICK_SCALE_LENGTH) * Math.exp(-absZ / THICK_SCALE_HEIGHT);
  const sphericalR = Math.max(Math.hypot(radius, absZ), 500);
  const halo = 0.0008 * (sphericalR / 8000) ** -3.5;

  return thin + thick + halo;
}

/** Dust density for extinction, concentrated in a thin midplane layer. */
export function dustDensity(position: GalacticPosition): number {
  const radius = Math.hypot(position.xPc, position.yPc);
  return Math.exp(-radius / 2600) * Math.exp(-Math.abs(position.zPc) / 120);
}
