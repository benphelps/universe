import { stellarHaloDensity } from './stellarHalo';
import { bulgeDensity } from './spheroid';
import { closestSpiralArm, spiralProfile, SPIRAL_LIMITS } from './spiralStructure';

/**
 * Analytic stellar density model of the galaxy, stars per cubic parsec,
 * in galactocentric cartesian coordinates (parsecs, z out of the disk).
 * Components: double-exponential thin and thick disks, a broken-law stellar halo, a normalized bulge,
 * and finite spiral arms as an annular redistribution. The
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

/** Conservative bounds, from sums of nonnegative ridge amplitudes. Each
 * ridge's subtracted mean is nonnegative, so the positive ceiling cannot
 * grow with overlap, pitch, branch count, or interpolation. */
export const ARM_BOOST_MAX = 1 + SPIRAL_LIMITS.starWeight;
export const DUST_FACTOR_MAX = 1 + 1.4 * SPIRAL_LIMITS.dustWeight;
const WAVE_MIN_RADIUS_PC = 500;

/** Signed contrasts with exactly zero mean around each annulus. */
export function armProfile(radiusPc: number, azimuthRad: number): { boost: number; lane: number } {
  return spiralProfile(radiusPc, azimuthRad);
}

/** Positive total stellar factor; between arms it can be below one. */
export function armBoost(radiusPc: number, azimuthRad: number): number {
  return 1 + spiralProfile(radiusPc, azimuthRad, undefined, false).boost;
}

/** Physical planar distance to a finite named arm or one of its branches. */
export const nearestArm = closestSpiralArm;

/**
 * The smooth model's numbers, for a renderer that evaluates it on a
 * GPU: the same constants the functions below use, exported so a
 * shader mirror reads them rather than restating them.
 */
export const SMOOTH_MODEL = {
  thinNorm: THIN_NORM,
  thinScaleLengthPc: THIN_SCALE_LENGTH,
  thinScaleHeightPc: THIN_SCALE_HEIGHT,
  thickNorm: THICK_NORM,
  thickScaleLengthPc: THICK_SCALE_LENGTH,
  thickScaleHeightPc: THICK_SCALE_HEIGHT,
  dustScaleLengthPc: 2600,
  dustScaleHeightPc: 120,
  dustLaneWeight: 1.4,
  waveMinRadiusPc: WAVE_MIN_RADIUS_PC,
} as const;

/** Thin disk before any arm enhancement, at cylindrical radius and |z|. */
function thinSmooth(radiusPc: number, absZPc: number): number {
  return (
    THIN_NORM * Math.exp(-radiusPc / THIN_SCALE_LENGTH) * Math.exp(-absZPc / THIN_SCALE_HEIGHT)
  );
}

/** Thick disk: no wave rides it, so there is only the one form. */
function thickSmooth(radiusPc: number, absZPc: number): number {
  return (
    THICK_NORM * Math.exp(-radiusPc / THICK_SCALE_LENGTH) * Math.exp(-absZPc / THICK_SCALE_HEIGHT)
  );
}

/** Shared mass-calibrated oblate stellar halo. */
function haloSmooth(radiusPc: number, absZPc: number): number {
  return stellarHaloDensity(radiusPc, absZPc);
}

export interface ComponentDensities {
  thin: number;
  thick: number;
  halo: number;
  bulge: number;
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
  const dust = Math.exp(-radius / 2600) * Math.exp(-absZ / 120) * (1 + 1.4 * lane);
  return {
    thin: thinSmooth(radius, absZ) * (1 + boost),
    thick: thickSmooth(radius, absZ),
    halo: haloSmooth(radius, absZ),
    bulge: bulgeDensity(Math.hypot(radius, absZ)),
    dust,
    armBoost: 1 + boost,
  };
}

/** The smooth field components alone — no wave or bulge: shared by every galaxy
 *  (spiral and bulge structure vary between seeds), so universal bounds can rest
 *  on it without committing the session to a galaxy. */
export function smoothComponentDensities(position: GalacticPosition): ComponentDensities {
  const radius = Math.hypot(position.xPc, position.yPc);
  const absZ = Math.abs(position.zPc);
  return {
    thin: thinSmooth(radius, absZ),
    thick: thickSmooth(radius, absZ),
    halo: haloSmooth(radius, absZ),
    bulge: 0,
  };
}

/** Per-component stellar densities, stars per pc³. */
export function componentDensities(position: GalacticPosition): ComponentDensities {
  const radius = Math.hypot(position.xPc, position.yPc);
  const absZ = Math.abs(position.zPc);
  return {
    thin: thinSmooth(radius, absZ) * armBoost(radius, Math.atan2(position.yPc, position.xPc)),
    thick: thickSmooth(radius, absZ),
    halo: haloSmooth(radius, absZ),
    bulge: bulgeDensity(Math.hypot(radius, absZ)),
  };
}

/**
 * Total stellar density, stars per pc³.
 *
 * The star field asks this once per candidate — a couple of hundred
 * thousand times to fill a neighbourhood — and it is the caller with
 * no use for the dust. Going through sightlineDensities to get here
 * bought a dust lane and threw it away, and the lane is not a cheap
 * thing to buy.
 */
export function stellarDensity(position: GalacticPosition): number {
  const radius = Math.hypot(position.xPc, position.yPc);
  const absZ = Math.abs(position.zPc);
  return (
    thinSmooth(radius, absZ) * armBoost(radius, Math.atan2(position.yPc, position.xPc)) +
    thickSmooth(radius, absZ) +
    haloSmooth(radius, absZ) + bulgeDensity(Math.hypot(radius, absZ))
  );
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
  return thin + thick + haloSmooth(radius, absZ) + bulgeDensity(Math.hypot(radius, absZ));
}

/** Dust density for extinction: a thin midplane layer with narrow
 *  patchy lanes and branches sharing the stellar morphology. */
export function dustDensity(position: GalacticPosition): number {
  return sightlineDensities(position).dust;
}

/** Visual opacity of unit dust density, per parsec — the same 45 per
 *  kpc the glow map and the volume march accumulate. */
export const DUST_OPACITY_PER_PC = 0.045;

/** Optical albedo of interstellar dust (Draine): the share of what
 *  falls on a grain that leaves it again as scattered light. */
export const DUST_ALBEDO = 0.6;

/** Henyey–Greenstein asymmetry of interstellar grains in the optical:
 *  strongly forward-scattering. */
export const HG_G = 0.6;

/**
 * Optical depth between two points, integrating the dust layer along
 * the straight path. Nothing at the galactic centre is visible from
 * the disk in optical light — the column between is dozens of depths
 * deep — and this is the number that says so.
 */
export function dustOpticalDepth(
  from: GalacticPosition,
  to: GalacticPosition,
  // The dust layer is 120 pc thin and a sightline can be tens of kpc
  // long: too few samples and a grazing path misses the layer entirely.
  steps = 256,
): number {
  const dx = to.xPc - from.xPc;
  const dy = to.yPc - from.yPc;
  const dz = to.zPc - from.zPc;
  const lengthPc = Math.hypot(dx, dy, dz);
  if (lengthPc < 1e-6) return 0;
  const step = lengthPc / steps;
  let tau = 0;
  for (let i = 0; i < steps; i++) {
    const f = (i + 0.5) / steps;
    tau += dustDensity({
      xPc: from.xPc + dx * f,
      yPc: from.yPc + dy * f,
      zPc: from.zPc + dz * f,
    });
  }
  return tau * step * DUST_OPACITY_PER_PC;
}
