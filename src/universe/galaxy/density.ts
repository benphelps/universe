import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { galaxyRoot, galaxySeed, PRIME_GALAXY_SEED } from './galaxySeed';

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

const ARM_INNER_RADIUS = 3000;
/** Where orbit ovalness peaks and where it dies back to circular. */
const WAVE_CORE = 4200;
const WAVE_DISK = 15000;
/** Caustic clamp: the crowding Jacobian never divides past this. */
const WAVE_J_MIN = 0.3;

/**
 * The density wave's free parameters. The prime galaxy keeps its
 * canonical values exactly; any other galaxy seed derives its own
 * within ranges that keep the ARM_BOOST_MAX ceiling and the rim/core
 * structure intact — amplitudes never vary, only shapes and phases.
 */
export interface WaveParams {
  pitchTan: number;
  qDepth: number;
  wobble1Amp: number;
  wobble1Freq: number;
  wobble1Phase: number;
  wobble2Amp: number;
  wobble2Freq: number;
  wobble2Phase: number;
  segFreq: number;
  segPhase: number;
  segCouple: number;
  knotFreq1: number;
  knotPhase1: number;
  knotCouple: number;
  knotFreq2: number;
  knotPhase2: number;
  asymAmp: number;
  asymPhase: number;
  laneShift: number;
  /** Co-wave phase of the crowding caustic (measured numerically). */
  ridgePhase: number;
}

const PRIME_WAVE: WaveParams = {
  pitchTan: Math.tan((12 * Math.PI) / 180),
  qDepth: 0.16,
  wobble1Amp: 0.14,
  wobble1Freq: 1.1,
  wobble1Phase: 1.3,
  wobble2Amp: 0.06,
  wobble2Freq: 2.6,
  wobble2Phase: 4.2,
  segFreq: 1.9,
  segPhase: 5.1,
  segCouple: 1.7,
  knotFreq1: 7.0,
  knotPhase1: 1.0,
  knotCouple: 2.0,
  knotFreq2: 4.3,
  knotPhase2: 0.9,
  asymAmp: 0.28,
  asymPhase: 0.8,
  laneShift: 0.07,
  ridgePhase: -0.45,
};

let waveParamsMemo: WaveParams | null = null;

export function waveParams(): WaveParams {
  if (waveParamsMemo) return waveParamsMemo;
  if (galaxySeed() === PRIME_GALAXY_SEED) {
    waveParamsMemo = PRIME_WAVE;
    return waveParamsMemo;
  }
  const rng = new Rng(deriveSeed(galaxyRoot(0x57415645n), 'wave'));
  const params: WaveParams = {
    pitchTan: Math.tan((rng.range(9.5, 16.5) * Math.PI) / 180),
    qDepth: rng.range(0.1, 0.22),
    wobble1Amp: rng.range(0.08, 0.2),
    wobble1Freq: rng.range(0.8, 1.5),
    wobble1Phase: rng.range(0, 2 * Math.PI),
    wobble2Amp: rng.range(0.03, 0.09),
    wobble2Freq: rng.range(2.0, 3.4),
    wobble2Phase: rng.range(0, 2 * Math.PI),
    segFreq: rng.range(1.4, 2.4),
    segPhase: rng.range(0, 2 * Math.PI),
    segCouple: rng.range(1.2, 2.2),
    knotFreq1: rng.range(5, 9),
    knotPhase1: rng.range(0, 2 * Math.PI),
    knotCouple: rng.range(1.4, 2.6),
    knotFreq2: rng.range(3.2, 5.4),
    knotPhase2: rng.range(0, 2 * Math.PI),
    asymAmp: rng.range(0.18, 0.34),
    asymPhase: rng.range(0, 2 * Math.PI),
    laneShift: rng.range(0.05, 0.1),
    ridgePhase: 0,
  };
  waveParamsMemo = params;
  // The caustic's co-wave phase follows from the geometry: find it
  // once by scanning the crowding around a reference ring.
  let bestPhase = 0;
  let bestCrowd = 0;
  const tilt = waveTilt(8000);
  for (let i = 0; i < 128; i++) {
    const phase = -Math.PI + (i * 2 * Math.PI) / 128;
    const crowd = waveCrowding(8000, tilt + phase);
    if (crowd > bestCrowd) {
      bestCrowd = crowd;
      bestPhase = phase;
    }
  }
  params.ridgePhase = bestPhase;
  return waveParamsMemo;
}
/** Rigorous ceiling on armBoost anywhere: sampled max 5.05 over the
 *  clamped crowding times full patchiness, held with margin. */
export const ARM_BOOST_MAX = 6.1;

/** How much brighter the arm overdensity shines per star than the
 *  field: the young population — the luminous massive stars — lives in
 *  the arms it was born in. Multiplies arm EMISSION (band glow and
 *  exterior volume), never star counts. */
export const ARM_YOUNG_LIGHT = 4;

function wrapPi(angle: number): number {
  const m = (angle + Math.PI) % (2 * Math.PI);
  return (m < 0 ? m + 2 * Math.PI : m) - Math.PI;
}

function smooth01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** Winding phase of the guiding radius: how far around the log spiral
 *  an orbit of that size has turned. */
export function waveWinding(guidingPc: number): number {
  return Math.log(Math.max(guidingPc, ARM_INNER_RADIUS) / ARM_INNER_RADIUS) / waveParams().pitchTan;
}

/** Orientation of the oval orbit with guiding radius r₀: the log-spiral
 *  winding plus gentle bends — real waves are not perfect spirals. */
export function waveTilt(guidingPc: number): number {
  const p = waveParams();
  const u = waveWinding(guidingPc);
  return (
    u +
    p.wobble1Amp * Math.sin(p.wobble1Freq * u + p.wobble1Phase) +
    p.wobble2Amp * Math.sin(p.wobble2Freq * u + p.wobble2Phase)
  );
}

/** Axis ratio of the oval orbit: circular in the middle, most oval at
 *  the core boundary, relaxing back to circular at the rim — the
 *  density-wave eccentricity profile. */
export function waveAxisRatio(guidingPc: number): number {
  const bump =
    smooth01(guidingPc / WAVE_CORE) *
    (1 - smooth01((guidingPc - WAVE_CORE) / (WAVE_DISK - WAVE_CORE))) ** 0.8;
  return 1 - waveParams().qDepth * bump;
}

/** World radius of orbit r₀ where it crosses the given azimuth. */
export function waveRadius(guidingPc: number, azimuthRad: number): number {
  const g = azimuthRad - waveTilt(guidingPc);
  const q = waveAxisRatio(guidingPc);
  const c = Math.cos(g);
  const s = Math.sin(g);
  return (guidingPc * q) / Math.sqrt(q * q * c * c + s * s);
}

/** The guiding radius of the orbit passing through (r, azimuth):
 *  fixed-point inversion of waveRadius — a few iterations suffice
 *  because the ovals are gentle. */
export function waveGuidingRadius(radiusPc: number, azimuthRad: number): number {
  let guiding = radiusPc;
  for (let i = 0; i < 4; i++) {
    const g = azimuthRad - waveTilt(guiding);
    const q = waveAxisRatio(guiding);
    const c = Math.cos(g);
    const s = Math.sin(g);
    guiding = (radiusPc * Math.sqrt(q * q * c * c + s * s)) / q;
  }
  return guiding;
}

/** Crowding of the orbit family at a point whose orbit is already
 *  known: the inverse Jacobian of the family map, clamped at the
 *  caustic. 1 where orbits keep their spacing; larger where the
 *  density wave piles them up. Taking the guiding radius rather than
 *  solving for it is what lets a caller that has already solved spend
 *  the answer twice — the solve is the expensive half. */
function crowdingAt(guidingPc: number, azimuthRad: number): number {
  const h = 40;
  const jacobian =
    (waveRadius(guidingPc + h, azimuthRad) - waveRadius(guidingPc - h, azimuthRad)) / (2 * h);
  return 1 / Math.max(jacobian, WAVE_J_MIN);
}

/** Crowding at a point given in world coordinates. */
function waveCrowding(radiusPc: number, azimuthRad: number): number {
  return crowdingAt(waveGuidingRadius(radiusPc, azimuthRad), azimuthRad);
}

/** Inside this the wave has no structure to speak of and the core
 *  takes over; the orbit family is not solved there at all. */
const WAVE_MIN_RADIUS_PC = 500;

/**
 * Star-formation patchiness along the wave: slow stretches of the
 * orbit family make long beads, fast ones leave gaps. Shared, because
 * it modulates the stars and their dust alike.
 */
function segWeight(u: number, phase: number): number {
  const p = waveParams();
  return (
    0.45 +
    0.55 *
      (0.5 + 0.5 * Math.sin(p.segFreq * u + p.segPhase + p.segCouple * Math.cos(phase))) ** 1.2
  );
}

/** The stellar enhancement itself, for a point already placed on its
 *  orbit — crowding, times the patchiness riding on it. */
function waveBoost(
  guidingPc: number,
  azimuthRad: number,
  u: number,
  phase: number,
  seg: number,
): number {
  const p = waveParams();
  const wave = Math.max(0, crowdingAt(guidingPc, azimuthRad) - 1);
  const knot = Math.max(
    0,
    Math.sin(p.knotFreq1 * u + p.knotPhase1 + p.knotCouple * Math.cos(phase)) *
      Math.sin(p.knotFreq2 * u + p.knotPhase2),
  );
  const asym = 1 + p.asymAmp * Math.cos(phase + p.asymPhase);
  return 0.98 * wave * seg * asym * (1 + 0.8 * knot * knot);
}

/**
 * The spiral structure at one disk point: the stellar enhancement and
 * the dust-lane weight, both emergent from density-wave orbit crowding
 * (after Lin–Shu, construction after beltoforion's renderer): nested
 * oval orbits, each tilted a little further with size, pile up along
 * two caustics — the arms. Width variation, the soft emergence out of
 * the round core, and the rim dissolve all follow from the orbit
 * family; star-formation patchiness (slow segments, compact knots, an
 * m=1 asymmetry) rides the wave as modulation in wave coordinates. The
 * dust lane is the same family wound slightly further, so it hugs each
 * arm's inner edge. Mirrored line for line by the galaxy-volume shader.
 */
export function armProfile(
  radiusPc: number,
  azimuthRad: number,
): { boost: number; lane: number } {
  if (radiusPc < WAVE_MIN_RADIUS_PC) return { boost: 0, lane: 0 };
  const guiding = waveGuidingRadius(radiusPc, azimuthRad);
  const u = waveWinding(guiding);
  const phase = azimuthRad - waveTilt(guiding);
  const seg = segWeight(u, phase);
  const boost = waveBoost(guiding, azimuthRad, u, phase, seg);
  // The dust family runs slightly ahead in winding: its caustic sits
  // on the arms' inner edge. Its orbit is a different one, so this is
  // the one solve that cannot be shared.
  const laneWave = Math.max(0, waveCrowding(radiusPc, azimuthRad + waveParams().laneShift) - 1);
  const lane = Math.min(1.6, 0.5 * laneWave) * (0.4 + 0.6 * seg);
  return { boost, lane };
}

/**
 * Spiral-arm density enhancement factor (1 between arms, up to
 * ~ARM_BOOST_MAX in a star-forming bead).
 *
 * Its own entry point rather than armProfile's first field, because
 * the caller that asks for it most — the star field, once per
 * candidate — has no use for the dust lane, and the lane costs a
 * whole second inversion of the orbit family. Between that and
 * handing the crowding an orbit already solved, this answers with one
 * fixed-point solve where the pair costs three.
 */
export function armBoost(radiusPc: number, azimuthRad: number): number {
  if (radiusPc < WAVE_MIN_RADIUS_PC) return 1;
  const guiding = waveGuidingRadius(radiusPc, azimuthRad);
  const u = waveWinding(guiding);
  const phase = azimuthRad - waveTilt(guiding);
  return 1 + waveBoost(guiding, azimuthRad, u, phase, segWeight(u, phase));
}

/** Which spiral arm a locale is closest to, and how far off its
 *  ridge — the crowding caustic of the wave the density rides. */
export function nearestArm(
  radiusPc: number,
  azimuthRad: number,
): { index: number; distancePc: number } {
  const ridgeBase = waveTilt(radiusPc) + waveParams().ridgePhase;
  let index = 0;
  let nearest = Infinity;
  for (let arm = 0; arm < 2; arm++) {
    const distance = Math.abs(wrapPi(azimuthRad - (ridgeBase + arm * Math.PI))) * radiusPc;
    if (distance < nearest) {
      nearest = distance;
      index = arm;
    }
  }
  return { index, distancePc: nearest };
}

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
  haloNorm: 0.0008,
  haloFloorPc: 500,
  haloReferencePc: 8000,
  haloIndex: -3.5,
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

/** Halo: spherical, and floored inside the core so it stays finite. */
function haloSmooth(radiusPc: number, absZPc: number): number {
  return 0.0008 * (Math.max(Math.hypot(radiusPc, absZPc), 500) / 8000) ** -3.5;
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
  const dust = Math.exp(-radius / 2600) * Math.exp(-absZ / 120) * (1 + 1.4 * lane);
  return {
    thin: thinSmooth(radius, absZ) * (1 + boost),
    thick: thickSmooth(radius, absZ),
    halo: haloSmooth(radius, absZ),
    dust,
    armBoost: 1 + boost,
  };
}

/** The smooth components alone — no wave: shared by every galaxy
 *  (only the wave varies between seeds), so universal bounds can rest
 *  on it without committing the session to a galaxy. */
export function smoothComponentDensities(position: GalacticPosition): ComponentDensities {
  const radius = Math.hypot(position.xPc, position.yPc);
  const absZ = Math.abs(position.zPc);
  return {
    thin: thinSmooth(radius, absZ),
    thick: thickSmooth(radius, absZ),
    halo: haloSmooth(radius, absZ),
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
    haloSmooth(radius, absZ)
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
  const sphericalR = Math.max(Math.hypot(radius, absZ), 500);
  return thin + thick + 0.0008 * (sphericalR / 8000) ** -3.5;
}

/** Dust density for extinction: a thin midplane layer with narrow
 *  lanes hugging the spiral arms' inner edges. */
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
