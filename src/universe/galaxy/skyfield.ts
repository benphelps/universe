import {
  blackbodyLinearRgb,
  buildTemperatureLut,
  temperatureToLutCoord,
} from '../../core/color/blackbody';
import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { powerLaw } from '../../core/rng/distributions';
import { initialMassFromUnit, KROUPA_SEGMENTS } from '../star/imf';
import { evolve } from '../star/evolution';
import { MASS_BIT_SPAN, seedForIdentity, unitFromBits } from '../star/identity';
import {
  CATALOG_ROWS,
  luminosityCeiling,
  sweepRowStars,
  taperKeep,
  unitAtPosition,
  type CatalogRow,
  type SweepTaper,
} from './catalog';
import { neighborRadiusPc } from './neighborhood';
import {
  cloudDustFactor,
  cloudLocalDensity,
  cloudReachPc,
  cloudsNear,
  ENVELOPE_REACH,
  expectedCloudField,
  type MolecularCloud,
} from './clouds';
import {
  ARM_YOUNG_LIGHT,
  DUST_OPACITY_PER_PC,
  dustDensity,
  HOME_POSITION,
  sightlineDensities,
  stellarDensity,
  type GalacticPosition,
} from './density';
import {
  MEMBER_SPREAD,
  nebulaEmissionShare,
  nebulaFor,
  nebulaGasAt,
  nebulaIlluminant,
  nebulaLightSolar,
  nebulaLineLuminositySolar,
  nebulaScatteredSolar,
  type Nebula,
} from './nebula';
import { NEBULA_MEAN_U, nebulaEmissionColor, nebulaNarrowbandColor } from './nebulaLines';
import { displaySurfaceBrightness } from './displayLaw';
import { SCATTER_TINT_RGB } from './dustScattering';
import { rotateToScene, sceneFromGalaxy } from './orientation';
import { companionLuminosity, starPhotometry } from './photometry';
import { populationFromUnit } from './population';
import { galaxyRoot } from './galaxySeed';
import { sectorNameForSeed, sectorSeedAt } from './regions';

/**
 * The sky as seen from a point in the galaxy: every star bright enough
 * to resolve as a point (near stars individually from their sectors,
 * far bright stars statistically), plus a lat-long glow map of the
 * unresolved Milky Way band with dust-lane extinction.
 */
export interface NebulaPatch {
  /** The natal cloud's seed: the nebula's identity (and its name). */
  seed: bigint;
  distancePc: number;
  /** Unit view direction (galactic frame, like starDirs). */
  dir: [number, number, number];
  /** The cloud's nominal radius on the sky, radians: the tile spans
   *  ENVELOPE_REACH times this, which for a drawn-out cloud is its
   *  full reach, so the body is never sliced by the tile's edge. */
  angularRadius: number;
  /** Linear sRGB emission hue (tile pixels carry the per-pixel mix). */
  color: [number, number, number];
  /** Display energy at the tile's peak under the camera transfer —
   *  what ranks salience and pick priority, viewpoint-stable. */
  brightness: number;
  /** Radiance at the tile's unit relative luminance, L☉ pc⁻² sr⁻¹ —
   *  the physics the sky shader exposes under whatever instrument is
   *  standing. */
  peakRadiance: number;
  /** Unit-luminance line and scattered-continuum hues; the tile's
   *  green channel mixes between them per pixel. The narrowband hue
   *  is the same grid through the mapped palette, carried so an
   *  instrument switch never re-bakes a sky. */
  emissionHue: [number, number, number];
  emissionHueNarrow: [number, number, number];
  reflectionHue: [number, number, number];
  /** Tangent-plane basis (galactic frame) matching the sprite tile. */
  right: [number, number, number];
  up: [number, number, number];
  /** Tile index into the nebula sprite atlas. */
  tile: number;
}

/** Nebula sprite atlas layout: NEBULA_TILE² RGBA tiles in a grid.
 *  Sized for the sprite's worst honest case — a nebula large in frame
 *  whose volume has not stood up yet — where a coarse tile stretches
 *  into visible blocks. The whole atlas costs ~1.2 s of background
 *  bake at this size, against a star sweep that runs far longer. */
export const NEBULA_TILE = 128;
export const NEBULA_ATLAS_COLS = 8;
export const NEBULA_ATLAS_ROWS = 6;

/** Cloud-shadow transmission map resolution (4× the glow map). */
export const RIFT_WIDTH = 768;
export const RIFT_HEIGHT = 384;

/** Dark-cloud sprite atlas: transmission tiles, one per prominent cloud. */
export const DARK_TILE = 96;
export const DARK_ATLAS_COLS = 8;
export const DARK_ATLAS_ROWS = 8;

export interface DarkCloudPatch {
  /** The cloud's seed: the dark nebula's identity (and its name). */
  seed: bigint;
  distancePc: number;
  /** Unit view direction (galactic frame). */
  dir: [number, number, number];
  /** Tangent half-extent of the sprite, radians. */
  halfExtent: number;
  /** Tangent-plane basis (galactic frame) matching the sprite tile. */
  right: [number, number, number];
  up: [number, number, number];
  /** Tile index into the dark-cloud transmission atlas. */
  tile: number;
}

export interface SkyField {
  starCount: number;
  /** The first nearStarCount entries are the resolved 30 pc neighborhood
   *  (a 3D view of the same region should skip them to avoid doubling). */
  nearStarCount: number;
  /** Unit view directions, xyz per star. */
  starDirs: Float32Array;
  /** Linear sRGB hue per star. */
  starColors: Float32Array;
  /** Relative irradiance per star (L☉/pc²). */
  starBrightness: Float32Array;
  /** Distance (pc) and effective temperature (K) per star. */
  starDistances: Float32Array;
  starTeffs: Float32Array;
  /** Seed per star: every catalog glint is a real, travelable star.
   *  Zero marks cluster/group members, which are not yet addressable. */
  starSeeds: BigUint64Array;
  /** Emission/reflection nebulae around the youngest groups. */
  nebulae: NebulaPatch[];
  /** Ray-marched sprite per nebula (see NEBULA_TILE / atlas layout). */
  nebulaAtlas: Float32Array;
  glowWidth: number;
  glowHeight: number;
  /** Lat-long map of the unresolved background: column radiance in R
   *  (L☉ pc⁻² sr⁻¹), dust reddening in G — physics, displayed by the
   *  glow shader under the standing instrument. */
  glowData: Float32Array;
  /** The darkest column's radiance — the sky's own measured pedestal,
   *  which every extended tier's display subtracts. */
  skyFloorRadiance: number;
  /** Lat-long transmission through small distant clouds (RIFT_WIDTH ×
   *  HEIGHT, one float per texel); the prominent ones ride as sprites. */
  riftData: Float32Array;
  /** The prominent nearby dark clouds, sprite-projected like nebulae. */
  darkClouds: DarkCloudPatch[];
  /** Ray-marched transmission tile per dark cloud (DARK_TILE² each). */
  darkAtlas: Float32Array;
  /** Row-major galactic→scene rotation: each system's frame sits at its
   *  own random orientation within the galaxy. */
  sceneFromGalaxy: Float32Array;
  /** Chart-territory borders as scene-frame pc segments (xyz pairs). */
  sectorBounds: Float32Array;
  /** The borders of the home locale's own territory, same encoding. */
  sectorHomeBounds: Float32Array;
  /** Constellation borders: the local sky cut around its prominent
   *  landmarks (scene-frame pc, on the SKY_DRAW_RADIUS_PC sphere). */
  constellationBounds: Float32Array;
  /** Names for the chart provinces around home (scene-frame pc). */
  sectorLabels: SectorLabel[];
  /** A name per constellation at its region's center direction — the
   *  name of the nebula or rift that organizes it. */
  constellationLabels: SectorLabel[];
  /** Bayer garnish, local to this sky: the brightest addressable glint
   *  in each constellation, star seed → "α <Constellation>". */
  bayerNames: Map<bigint, string>;
}

export interface SectorLabel {
  name: string;
  x: number;
  y: number;
  z: number;
  home: boolean;
}

/** Keep far stars down to apparent magnitude ≈ 9. */
const MIN_FAR_IRRADIANCE = 1.5e-4;

/** The furthest the near census — every star, whatever its light —
 *  ever reaches; the neighbourhood shrinks it where the disk is dense,
 *  and the sky's own split follows the neighbourhood exactly, so the
 *  far field begins where the 3D points end and no shell goes undrawn. */
const NEAR_RADIUS_PC = 30;
/**
 * How far past its reach a sweep tapers, as a factor of that reach. A
 * row's sky radius is a compute budget well inside where its brightest
 * members are still visible, and the near census ends where the
 * neighbourhood does — each a sphere the sky would otherwise show as
 * a step in its star density. The band beyond thins to nothing in
 * proportion to the distance left, so the sky's density falls off
 * rather than dropping.
 */
const SWEEP_TAPER = 1.5;
/** The census taper runs further: a census of every star is a
 *  hundred times the magnitude-limited sky's density, and a fall that
 *  steep needs the room. */
const NEAR_TAPER = 2;

/** How far a row's sweep actually runs: its reach and the taper past
 *  it, or the census taper for a row with no reach of its own. */
function rowSweepRadiusPc(row: CatalogRow): number {
  return Math.max(NEAR_RADIUS_PC * NEAR_TAPER, row.skyRadiusPc * SWEEP_TAPER);
}

/** Fraction of stars above a mass cut under the Kroupa IMF. */
export function imfFractionAbove(massCut: number): number {
  let total = 0;
  let above = 0;
  let coefficient = 1;
  let previousAlpha = KROUPA_SEGMENTS[0].alpha;
  for (const segment of KROUPA_SEGMENTS) {
    coefficient *= segment.min ** (segment.alpha - previousAlpha);
    previousAlpha = segment.alpha;
    const integral = (from: number, to: number): number => {
      const p = 1 - segment.alpha;
      return (coefficient * (to ** p - from ** p)) / p;
    };
    total += integral(segment.min, segment.max);
    if (massCut < segment.max) {
      above += integral(Math.max(massCut, segment.min), segment.max);
    }
  }
  return above / total;
}

interface StarAccum {
  dirs: number[];
  colors: number[];
  brightness: number[];
  distances: number[];
  teffs: number[];
  seeds: bigint[];
}

/** What a mass stratum's sweep should call itself on a progress bar. */
export function rowStageName(row: { massHi: number }): string {
  if (row.massHi <= 1.1) return 'dwarf stars';
  if (row.massHi <= 2.2) return 'sunlike stars';
  if (row.massHi <= 7) return 'hot stars';
  return 'giants & rarities';
}

/** Measured share of the star sweep each catalog row costs; equal
 *  split when the row count changes. Rough by design. */
const ROW_PROGRESS_WEIGHTS = [0.31, 0.12, 0.32, 0.01, 0.23, 0.01];

export type SkyProgress = (
  fraction: number,
  stage: string,
  /** Progress within the stage; −1 when the stage has no measure. */
  stageFraction: number,
) => void;

export function buildSkyField(
  viewpoint: GalacticPosition,
  seed = 0n,
  /** Rough build progress — phase weights are approximate. */
  onProgress?: SkyProgress,
): SkyField {
  const rowWeights = catalogRowWeights();
  let rowsBehind = 0;
  let rowIndex = 0;
  const slabs: SweepSlab[] = [];
  for (const row of CATALOG_ROWS) {
    const weight = rowWeights[rowIndex++];
    const stage = rowStageName(row);
    onProgress?.(0.84 * rowsBehind, stage, 0);
    const span = rowSlabSpan(row, viewpoint);
    slabs.push(
      sweepRowSlab(row, viewpoint, { ixLo: span.lo, ixHi: span.hi }, (slabFraction) =>
        onProgress?.(0.84 * (rowsBehind + weight * slabFraction), stage, slabFraction),
      ),
    );
    rowsBehind += weight;
  }
  return assembleSkyField(viewpoint, seed, slabs, onProgress);
}

/** Per-row share of the star sweep, for progress weighting. */
export function catalogRowWeights(): number[] {
  return CATALOG_ROWS.length === ROW_PROGRESS_WEIGHTS.length
    ? ROW_PROGRESS_WEIGHTS
    : CATALOG_ROWS.map(() => 1 / CATALOG_ROWS.length);
}

/** A sweep result as transferable arrays: the unit of parallelism. */
export interface PackedStars {
  dirs: Float32Array;
  colors: Float32Array;
  brightness: Float32Array;
  distances: Float32Array;
  teffs: Float32Array;
  seeds: BigUint64Array;
}

export interface SweepSlab {
  near: PackedStars;
  far: PackedStars;
}

/**
 * The half of a sky that the star sweep has no say in: where the gas
 * and dust are, where the chart borders run, and how bright the
 * unresolved background is in every direction. Built beside the sweep
 * rather than after it, and shown as soon as it lands.
 */
export interface SkyBackground {
  nebulae: NebulaPatch[];
  nebulaAtlas: Float32Array;
  darkClouds: DarkCloudPatch[];
  darkAtlas: Float32Array;
  /** Cluster and nebula members, which are not in the catalogue. They
   *  join the star list after every swept star, where they have always
   *  gone. */
  groupStars: PackedStars;
  sceneFromGalaxy: Float32Array;
  sectorBounds: Float32Array;
  sectorHomeBounds: Float32Array;
  sectorLabels: SectorLabel[];
  glowWidth: number;
  glowHeight: number;
  glowData: Float32Array;
  /** The darkest column's radiance — the sky's own measured pedestal,
   *  which every extended tier's display subtracts. */
  skyFloorRadiance: number;
  riftData: Float32Array;
}

/** The background on its way to the screen, ahead of the stars. */
export interface SkyBackgroundPreview {
  seedHex: string;
  background: SkyBackground;
}

/**
 * One slab's worth of far stars, on their way to the screen while the
 * rest of the sky is still being swept. Enough to draw them and
 * nothing else.
 */
export interface SkyPreview {
  seedHex: string;
  dirs: Float32Array;
  colors: Float32Array;
  brightness: Float32Array;
  distances: Float32Array;
}

/** The ix-slab span a row's sweep covers — how a coordinator splits
 *  the work. Mirrors sweepRowStars' own grid math. */
export function rowSlabSpan(
  row: CatalogRow,
  viewpoint: GalacticPosition,
): { lo: number; hi: number } {
  const radius = rowSweepRadiusPc(row);
  return {
    lo: Math.floor((viewpoint.xPc - radius) / row.cellPc),
    hi: Math.floor((viewpoint.xPc + radius) / row.cellPc),
  };
}

export interface SweepBounds {
  ixLo: number;
  ixHi: number;
  iyLo?: number;
  iyHi?: number;
}

/**
 * How to cut a row's sweep into pieces a pool can share.
 *
 * The obvious cut is by ix, and for a fine-celled row there are plenty
 * of columns to go round. A coarse one has almost none: the widest row
 * in the catalogue reaches six hundred parsecs in cells a hundred and
 * sixty across, which is eight columns for the whole sky — so the
 * heaviest row of the build was handing four workers two pieces each,
 * and in the bulge, where density climbs steeply across a sweep, those
 * two were nothing like equal.
 *
 * So a row too narrow to cut by column is cut by row instead: each ix
 * becomes its own column, banded in iy. Order is what keeps this
 * lossless — the serial sweep runs ix outer and iy inner, so slabs
 * concatenated in that same order are byte-identical to it, which is
 * why an iy band never spans more than one ix.
 */
export function rowSlabPlan(
  row: CatalogRow,
  viewpoint: GalacticPosition,
  target: number,
): SweepBounds[] {
  const span = rowSlabSpan(row, viewpoint);
  const width = span.hi - span.lo + 1;
  if (width >= target) {
    const count = Math.max(1, Math.min(target, width));
    const bounds: SweepBounds[] = [];
    for (let c = 0; c < count; c++) {
      bounds.push({
        ixLo: span.lo + Math.floor((c * width) / count),
        ixHi: span.lo + Math.floor(((c + 1) * width) / count) - 1,
      });
    }
    return bounds;
  }

  const radius = rowSweepRadiusPc(row);
  const iyLo = Math.floor((viewpoint.yPc - radius) / row.cellPc);
  const iyHi = Math.floor((viewpoint.yPc + radius) / row.cellPc);
  const height = iyHi - iyLo + 1;
  const bands = Math.max(1, Math.min(Math.ceil(target / width), height));
  const bounds: SweepBounds[] = [];
  for (let ix = span.lo; ix <= span.hi; ix++) {
    for (let b = 0; b < bands; b++) {
      bounds.push({
        ixLo: ix,
        ixHi: ix,
        iyLo: iyLo + Math.floor((b * height) / bands),
        iyHi: iyLo + Math.floor(((b + 1) * height) / bands) - 1,
      });
    }
  }
  return bounds;
}

/**
 * Sweep one catalog row over a range of ix slabs into packed star
 * arrays. Cells seed their own generators, so any partition of the
 * span, concatenated in slab order, is byte-identical to the serial
 * sweep — parallelism cannot change the sky.
 */
export function sweepRowSlab(
  row: CatalogRow,
  viewpoint: GalacticPosition,
  bounds: SweepBounds,
  onProgress?: (fraction: number) => void,
): SweepSlab {
  const lut = buildTemperatureLut(96);
  const near = makeAccum();
  const far = makeAccum();
  // The near census reaches exactly as far as the neighbourhood's 3D
  // points do, then tapers: past it every star is kept by the taper's
  // share, drawn among the far points whatever its light, so the
  // census thins into the magnitude-limited sky instead of ending on
  // a sphere.
  const nearPc = neighborRadiusPc(viewpoint);
  const nearSq = nearPc * nearPc;
  const nearTaper: SweepTaper = { innerPc: nearPc, outerPc: nearPc * NEAR_TAPER };
  const reachTaper: SweepTaper = {
    innerPc: row.skyRadiusPc,
    outerPc: row.skyRadiusPc * SWEEP_TAPER,
  };
  sweepRowStars(
    row,
    viewpoint,
    rowSweepRadiusPc(row),
    (x, y, z, massBits, ageBits, entropy) => {
      const dx = x - viewpoint.xPc;
      const dy = y - viewpoint.yPc;
      const dz = z - viewpoint.zPc;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 2.5e-5) return;
      const distance = Math.sqrt(d2);
      const censused =
        d2 <= nearSq || unitAtPosition(x, y, z) < taperKeep(nearTaper, distance);
      if (censused) {
        const starSeed = seedForIdentity(massBits, ageBits, entropy);
        const physical = starPhotometry(starSeed, { xPc: x, yPc: y, zPc: z });
        if (physical.luminosity <= 0) return;
        // Unresolved binaries glint with the pair's combined light.
        const luminosity =
          physical.luminosity + companionLuminosity(starSeed, { xPc: x, yPc: y, zPc: z });
        pushTo(d2 <= nearSq ? near : far, lut, dx, dy, dz, luminosity, physical.tEff, starSeed);
        return;
      }
      if (distance > reachTaper.outerPc) return;
      const mass = initialMassFromUnit(unitFromBits(massBits, MASS_BIT_SPAN));
      if (luminosityCeiling(mass) / d2 < MIN_FAR_IRRADIANCE) return;
      const starSeed = seedForIdentity(massBits, ageBits, entropy);
      const physical = starPhotometry(starSeed, { xPc: x, yPc: y, zPc: z });
      if (physical.luminosity / d2 < MIN_FAR_IRRADIANCE) return;
      const luminosity =
        physical.luminosity + companionLuminosity(starSeed, { xPc: x, yPc: y, zPc: z });
      pushTo(far, lut, dx, dy, dz, luminosity, physical.tEff, starSeed);
    },
    onProgress,
    bounds,
    // The generator's own thinning past the row's reach: the near
    // census taper is decided above, so only the reach tapers here —
    // and a near-only row, with no reach, is swept to its census
    // taper untouched.
    row.skyRadiusPc > 0 ? reachTaper : undefined,
  );
  return { near: packAccum(near), far: packAccum(far) };
}

function makeAccum(): StarAccum {
  return { dirs: [], colors: [], brightness: [], distances: [], teffs: [], seeds: [] };
}

function pushTo(
  acc: StarAccum,
  lut: Float32Array,
  dx: number,
  dy: number,
  dz: number,
  luminosity: number,
  tEff: number,
  starSeed: bigint,
): void {
  const distanceSq = dx * dx + dy * dy + dz * dz;
  if (distanceSq < 1e-6) return;
  const distance = Math.sqrt(distanceSq);
  const lutIndex = Math.min(95, Math.floor(temperatureToLutCoord(tEff) * 95)) * 4;
  acc.dirs.push(dx / distance, dy / distance, dz / distance);
  acc.colors.push(lut[lutIndex], lut[lutIndex + 1], lut[lutIndex + 2]);
  acc.brightness.push(luminosity / distanceSq);
  acc.distances.push(distance);
  acc.teffs.push(tEff);
  acc.seeds.push(starSeed);
}

function packAccum(acc: StarAccum): PackedStars {
  return {
    dirs: new Float32Array(acc.dirs),
    colors: new Float32Array(acc.colors),
    brightness: new Float32Array(acc.brightness),
    distances: new Float32Array(acc.distances),
    teffs: new Float32Array(acc.teffs),
    seeds: BigUint64Array.from(acc.seeds),
  };
}

function appendPacked(acc: StarAccum, packed: PackedStars): void {
  for (let i = 0; i < packed.dirs.length; i++) acc.dirs.push(packed.dirs[i]);
  for (let i = 0; i < packed.colors.length; i++) acc.colors.push(packed.colors[i]);
  for (let i = 0; i < packed.brightness.length; i++) {
    acc.brightness.push(packed.brightness[i]);
    acc.distances.push(packed.distances[i]);
    acc.teffs.push(packed.teffs[i]);
    acc.seeds.push(packed.seeds[i]);
  }
}

/**
 * Everything after the star sweep: group stars and nebulae, dark
 * clouds, charts, and the glow — assembled onto the merged sweep
 * slabs (which must arrive in row-then-slab order).
 */
/**
 * Everything about a sky that the stars have no say in.
 *
 * The nebulae, the dark clouds and rifts, the chart borders and the
 * unresolved glow all follow from where the traveler is standing and
 * which galaxy they are standing in — nothing here reads the catalogue
 * sweep at all, and only the constellations, which are cut around the
 * bright stars, ever do. So this half can be built beside the sweep
 * instead of behind it, which is the difference between the Milky Way
 * arriving a couple of seconds in and arriving a minute in.
 *
 * The groups do push stars: young clusters and their nebulae light up
 * with members that are not in the catalogue. Those come back here
 * rather than going straight into a list, so the assembly can put them
 * exactly where they have always gone — after every swept star, which
 * is what keeps the order, and the constellations cut from it, the
 * same as when this ran at the end.
 */
export function buildSkyBackground(
  viewpoint: GalacticPosition,
  seed = 0n,
  onProgress?: SkyProgress,
): SkyBackground {
  const lut = buildTemperatureLut(96);
  const groupStars = makeAccum();
  const push: PushStar = (dx, dy, dz, luminosity, tEff) =>
    pushTo(groupStars, lut, dx, dy, dz, luminosity, tEff, 0n);

  const localDensity = stellarDensity(viewpoint);
  onProgress?.(0, 'nebulae', -1);
  const { nebulae, nebulaAtlas } = buildGroups(viewpoint, localDensity, push);
  onProgress?.(0.1, 'dark clouds', -1);
  const { darkClouds, darkAtlas, spriteSeeds } = buildDarkClouds(viewpoint, DUST_KAPPA);
  onProgress?.(0.25, 'charting', -1);
  const bounds = buildSectorBounds(viewpoint, sceneFromGalaxy(seed));
  const glow = buildGlow(viewpoint, spriteSeeds, (fraction) =>
    onProgress?.(0.3 + 0.7 * fraction, 'milky way glow', fraction),
  );

  return {
    nebulae,
    nebulaAtlas,
    darkClouds,
    darkAtlas,
    groupStars: packAccum(groupStars),
    sceneFromGalaxy: sceneFromGalaxy(seed),
    ...bounds,
    ...glow,
  };
}

export function assembleSkyField(
  viewpoint: GalacticPosition,
  seed = 0n,
  slabs: SweepSlab[] = [],
  onProgress?: SkyProgress,
  background?: SkyBackground,
): SkyField {
  const near = makeAccum();
  const far = makeAccum();
  for (const slab of slabs) appendPacked(near, slab.near);
  for (const slab of slabs) appendPacked(far, slab.far);
  const nearStarCount = near.brightness.length;

  const built = background ?? buildSkyBackground(viewpoint, seed, (fraction, stage) =>
    onProgress?.(0.84 + 0.05 * fraction, stage, -1),
  );
  const { nebulae, nebulaAtlas, darkClouds, darkAtlas } = built;
  // The group members go in after every swept star, where they have
  // always gone: the constellations are cut from this list in order.
  appendPacked(far, built.groupStars);
  onProgress?.(0.9, 'charting', -1);

  const join = (a: number[], b: number[]): Float32Array => {
    const out = new Float32Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  };
  const starCount = nearStarCount + far.brightness.length;
  const starSeeds = new BigUint64Array(starCount);
  for (let i = 0; i < nearStarCount; i++) starSeeds[i] = near.seeds[i];
  for (let i = 0; i < far.seeds.length; i++) starSeeds[nearStarCount + i] = far.seeds[i];
  const starDirs = join(near.dirs, far.dirs);
  const starBrightness = join(near.brightness, far.brightness);

  const constellations = buildConstellations(
    nebulae,
    darkClouds,
    built.sceneFromGalaxy,
    starDirs,
    starBrightness,
    starSeeds,
  );

  return {
    starCount,
    nearStarCount,
    starDirs,
    starColors: join(near.colors, far.colors),
    starBrightness,
    starDistances: join(near.distances, far.distances),
    starTeffs: join(near.teffs, far.teffs),
    starSeeds,
    nebulae,
    nebulaAtlas,
    darkClouds,
    darkAtlas,
    sceneFromGalaxy: built.sceneFromGalaxy,
    sectorBounds: built.sectorBounds,
    sectorHomeBounds: built.sectorHomeBounds,
    sectorLabels: built.sectorLabels,
    glowWidth: built.glowWidth,
    glowHeight: built.glowHeight,
    glowData: built.glowData,
    skyFloorRadiance: built.skyFloorRadiance,
    riftData: built.riftData,
    ...constellations,
  };
}

type PushStar = (dx: number, dy: number, dz: number, luminosity: number, tEff: number) => void;

/** Coeval members around a center, pushing the ones that resolve from
 *  here. The natal groups come from the nebula model instead; this is
 *  what is left for clusters that have long since left their gas. */
function groupMembers(
  rng: Rng,
  push: PushStar,
  dx: number,
  dy: number,
  dz: number,
  spreadPc: number,
  tries: number,
  minMass: number,
  ageGyr: number,
): void {
  for (let i = 0; i < tries; i++) {
    const mx = dx + rng.normal(0, spreadPc);
    const my = dy + rng.normal(0, spreadPc);
    const mz = dz + rng.normal(0, spreadPc * 0.7);
    const physical = evolve(powerLaw(rng, 2.3, minMass, 60), ageGyr);
    const distanceSq = mx * mx + my * my + mz * mz;
    if (physical.luminosity / distanceSq < MIN_FAR_IRRADIANCE) continue;
    push(mx, my, mz, physical.luminosity, physical.tEff);
  }
}

/** The natal group as sky: each member where it stands in its cloud,
 *  pushed if it resolves from here. */
function pushNebulaMembers(
  nebula: Nebula,
  push: PushStar,
  dx: number,
  dy: number,
  dz: number,
): void {
  for (const member of nebula.members) {
    const mx = dx + member.dxPc;
    const my = dy + member.dyPc;
    const mz = dz + member.dzPc;
    const distanceSq = mx * mx + my * my + mz * mz;
    if (member.luminosity / distanceSq < MIN_FAR_IRRADIANCE) continue;
    push(mx, my, mz, member.luminosity, member.tEff);
  }
}

/**
 * The two lights a lit cloud sends out, from the same budgets the
 * volume bake spends: the line mixture at the group's spectral
 * hardness, and the illuminant's continuum off the dust. What used to
 * be a hand-mixed hue ramp now reads the object — a dozen B stars are
 * a blue reflection complex however big their bubble, because their
 * lines carry a ten-thousandth of their continuum; an O group's lines
 * rival its continuum and the pink takes over.
 */
function nebulaHues(nebula: Nebula): {
  emission: [number, number, number];
  reflection: [number, number, number];
  share: number;
} {
  // The sprite reads the same line grid the volume does — the group's
  // hottest star and its own gas, at the representative U a whole
  // object stands for — and its scattered continuum wears the blue
  // tilt of the dust's opacity curve, standing in for the per-λ
  // march only the volume runs. Both hues at unit luminance, so the
  // tile's radiance channel carries all of the brightness.
  const [er, eg, eb] = nebulaEmissionColor(NEBULA_MEAN_U, nebula.maxTeff, nebula.metallicity);
  const illuminant = nebulaIlluminant(nebula);
  const [br, bg, bb] = blackbodyLinearRgb(Math.max(3000, illuminant?.tEff ?? 4000));
  const [sr, sg, sb] = [
    br * SCATTER_TINT_RGB[0],
    bg * SCATTER_TINT_RGB[1],
    bb * SCATTER_TINT_RGB[2],
  ];
  const scatterLum = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
  return {
    emission: [er, eg, eb],
    reflection: [sr / scatterLum, sg / scatterLum, sb / scatterLum],
    share: nebulaEmissionShare(nebula),
  };
}

/** The blended colour of the whole object, for tints and listings. */
function nebulaDisplayColor(nebula: Nebula): [number, number, number] {
  const { emission, reflection, share } = nebulaHues(nebula);
  return [
    reflection[0] + (emission[0] - reflection[0]) * share,
    reflection[1] + (emission[1] - reflection[1]) * share,
    reflection[2] + (emission[2] - reflection[2]) * share,
  ];
}

/**
 * Ray-march one lit cloud into an atlas tile: the cloud's field as the
 * region has re-plumbed it — the diluted interior, the swept shell and
 * its ionized skin, the natal cloud beyond — lit from the illuminant
 * with the flux floor the volume shines with, self-extinguished along
 * the view path at the dust's real opacity. Two mechanisms march
 * side by side, lines going as the ionized density squared and
 * scattered continuum as dust times flux, and each closes on its own
 * budget, so the tile's per-pixel line share is a measured thing.
 * Filaments, the bright rim, dark foreground lanes and soft edges all
 * come from the field itself.
 */
export function renderNebulaTile(
  atlas: Float32Array,
  tile: number,
  cloud: MolecularCloud,
  view: [number, number, number],
  nebula: Nebula,
): {
  right: [number, number, number];
  up: [number, number, number];
  peakRadiance: number;
  /** The share of the object's light that leaves it toward this
   *  viewpoint, its own dust having eaten the rest. */
  escaped: number;
} {
  const axis: [number, number, number] =
    Math.abs(view[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const right = normalize(cross(view, axis));
  const up = cross(view, right);

  // The tile covers the whole body: a drawn-out cloud reaches past its
  // nominal radius along its long axis, and a tile sized to the
  // radius alone would slice it off in a straight line.
  const extentPc = cloudReachPc(cloud);
  const steps = 16;
  const dt = (2 * extentPc) / steps;
  const source = nebulaIlluminant(nebula);
  const sx = source?.dxPc ?? 0;
  const sy = source?.dyPc ?? 0;
  const sz = source?.dzPc ?? 0;
  const floorSq = (MEMBER_SPREAD * cloud.radiusPc) ** 2;
  const atlasWidth = NEBULA_ATLAS_COLS * NEBULA_TILE;
  const tileX = (tile % NEBULA_ATLAS_COLS) * NEBULA_TILE;
  const tileY = Math.floor(tile / NEBULA_ATLAS_COLS) * NEBULA_TILE;

  // The tile carries physics, not pixels: relative luminance and the
  // local line-vs-scattered mix, and the sky shader colours and
  // exposes them under whatever instrument is standing — so a mode
  // change never re-bakes a sky.
  const lineY = new Float32Array(NEBULA_TILE * NEBULA_TILE);
  const scatterY = new Float32Array(NEBULA_TILE * NEBULA_TILE);
  // Each mechanism's integral with and without the view path's
  // extinction: the budget is what the gas emits, and what the tile
  // may show of it is what gets out.
  let lineSum = 0;
  let scatterSum = 0;
  let lineFree = 0;
  let scatterFree = 0;
  for (let j = 0; j < NEBULA_TILE; j++) {
    for (let i = 0; i < NEBULA_TILE; i++) {
      // Border stays empty so the atlas samples to zero at tile edges.
      if (i === 0 || j === 0 || i === NEBULA_TILE - 1 || j === NEBULA_TILE - 1) continue;
      const u = ((i + 0.5) / NEBULA_TILE) * 2 - 1;
      const v = ((j + 0.5) / NEBULA_TILE) * 2 - 1;
      const ox = (right[0] * u + up[0] * v) * extentPc;
      const oy = (right[1] * u + up[1] * v) * extentPc;
      const oz = (right[2] * u + up[2] * v) * extentPc;

      let tau = 0;
      let line = 0;
      let scatter = 0;
      for (let s = 0; s < steps; s++) {
        const t = -extentPc + (s + 0.5) * dt;
        const px = ox + view[0] * t;
        const py = oy + view[1] * t;
        const pz = oz + view[2] * t;
        const { dust, ionized } = nebulaGasAt(nebula, px, py, pz);
        if (dust <= 0 && ionized <= 0) continue;
        const shineSq = (px - sx) ** 2 + (py - sy) ** 2 + (pz - sz) ** 2;
        const scattering = (dust * dt) / Math.max(shineSq, floorSq);
        const emitting = ionized * ionized * dt;
        const transmitted = Math.exp(-tau);
        scatter += scattering * transmitted;
        line += emitting * transmitted;
        scatterFree += scattering;
        lineFree += emitting;
        tau += dust * DUST_OPACITY_PER_PC * dt;
      }
      const at = j * NEBULA_TILE + i;
      lineY[at] = line;
      scatterY[at] = scatter;
      lineSum += line;
      scatterSum += scatter;
    }
  }

  // Each mechanism closes on its own budget: its whole light crosses
  // this tile, so the radiance at a pixel follows from flux closure —
  // luminosity over 4πd² spread by the tile's own integral — and the
  // distance cancels, as it must: surface brightness carries none.
  // Spread by the unextinguished integral, so what the tile shows is
  // the budget less what the cloud's own dust took on the way out.
  const closure = NEBULA_TILE ** 2 / (16 * Math.PI * extentPc ** 2);
  const lineLum = nebulaLineLuminositySolar(nebula);
  const scatterLum = nebulaScatteredSolar(nebula);
  const lineScale = lineFree > 0 ? (lineLum * closure) / lineFree : 0;
  const scatterScale = scatterFree > 0 ? (scatterLum * closure) / scatterFree : 0;
  const escaped =
    lineLum + scatterLum > 0
      ? (lineLum * (lineFree > 0 ? lineSum / lineFree : 0) +
          scatterLum * (scatterFree > 0 ? scatterSum / scatterFree : 0)) /
        (lineLum + scatterLum)
      : 0;
  let peak = 1e-6;
  for (let at = 0; at < lineY.length; at++) {
    const radiance = lineScale * lineY[at] + scatterScale * scatterY[at];
    if (radiance > peak) peak = radiance;
  }
  for (let j = 0; j < NEBULA_TILE; j++) {
    for (let i = 0; i < NEBULA_TILE; i++) {
      const at = j * NEBULA_TILE + i;
      const dst = ((tileY + j) * atlasWidth + tileX + i) * 4;
      const lines = lineScale * lineY[at];
      const radiance = lines + scatterScale * scatterY[at];
      atlas[dst] = radiance / peak;
      atlas[dst + 1] = radiance > 0 ? lines / radiance : 0;
      atlas[dst + 2] = 0;
      atlas[dst + 3] = 1;
    }
  }
  return { right, up, peakRadiance: peak, escaped };
}

function cross(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(a: [number, number, number]): [number, number, number] {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}

interface NebulaCandidate {
  cloud: MolecularCloud;
  nebula: Nebula;
  view: [number, number, number];
  distancePc: number;
  maxTeff: number;
  /** Apparent flux, L☉/pc² — what ranks the atlas slots: the nearer
   *  and the more luminous outshine, as integrated light does. */
  fluxSolar: number;
}

/**
 * The young population forms where stars actually form: inside the
 * molecular clouds. A cloud currently forming stars contributes a
 * coeval group, and the natal cloud lit by its own newborns is the
 * nebula — emission or reflection by the hottest member, dark when
 * nothing luminous formed. Older clusters have dispersed from their
 * gas and ride as bare coeval knots.
 */
function buildGroups(
  viewpoint: GalacticPosition,
  localDensity: number,
  push: PushStar,
): { nebulae: NebulaPatch[]; nebulaAtlas: Float32Array } {
  const candidates: NebulaCandidate[] = [];

  for (const cloud of cloudsNear(viewpoint, 750)) {
    const nebula = nebulaFor(cloud);
    if (!nebula) continue;
    const dx = cloud.positionPc.xPc - viewpoint.xPc;
    const dy = cloud.positionPc.yPc - viewpoint.yPc;
    const dz = cloud.positionPc.zPc - viewpoint.zPc;
    const distance = Math.hypot(dx, dy, dz);
    // A sprite is an impostor of a volume, and this close it stands in
    // for something that would fill the sky. Lifted by the volume tier.
    if (distance < 50) continue;

    pushNebulaMembers(nebula, push, dx, dy, dz);
    if (nebula.maxTeff < 6500) continue;

    candidates.push({
      cloud,
      nebula,
      view: [dx / distance, dy / distance, dz / distance],
      distancePc: distance,
      maxTeff: nebula.maxTeff,
      fluxSolar: nebulaLightSolar(nebula) / (4 * Math.PI * distance * distance),
    });
  }

  // The atlas holds the brightest; ray-march only those.
  candidates.sort((a, b) => b.fluxSolar - a.fluxSolar);
  const kept = candidates.slice(0, NEBULA_ATLAS_COLS * NEBULA_ATLAS_ROWS);
  const nebulaAtlas = new Float32Array(
    NEBULA_ATLAS_COLS * NEBULA_TILE * NEBULA_ATLAS_ROWS * NEBULA_TILE * 4,
  );
  const nebulae: NebulaPatch[] = kept.map((candidate, tile) => {
    const { right, up, peakRadiance } = renderNebulaTile(
      nebulaAtlas,
      tile,
      candidate.cloud,
      candidate.view,
      candidate.nebula,
    );
    const { emission, reflection } = nebulaHues(candidate.nebula);
    return {
      seed: candidate.cloud.seed,
      distancePc: candidate.distancePc,
      dir: candidate.view,
      angularRadius: Math.min(
        0.35,
        cloudReachPc(candidate.cloud) / ENVELOPE_REACH / candidate.distancePc,
      ),
      color: nebulaDisplayColor(candidate.nebula),
      brightness: displaySurfaceBrightness(peakRadiance),
      peakRadiance,
      emissionHue: emission,
      emissionHueNarrow: nebulaNarrowbandColor(
        NEBULA_MEAN_U,
        candidate.nebula.maxTeff,
        candidate.nebula.metallicity,
      ),
      reflectionHue: reflection,
      right,
      up,
      tile,
    };
  });

  // Dispersed open clusters: ~1.8e-7 per pc³ in the young disk.
  const rng = new Rng(deriveSeed(galaxyRoot(0x534b59n), 'groups'));
  for (let i = 0; i < 130; i++) {
    const azimuth = rng.range(0, 2 * Math.PI);
    const planar = 600 * Math.sqrt(rng.float());
    const centerZ = rng.normal(0, 60);
    const dx = planar * Math.cos(azimuth);
    const dy = planar * Math.sin(azimuth);
    const dz = centerZ - viewpoint.zPc;
    const there = {
      xPc: viewpoint.xPc + dx,
      yPc: viewpoint.yPc + dy,
      zPc: centerZ,
    };
    const keep = rng.float() < Math.min(1, stellarDensity(there) / Math.max(localDensity, 1e-4));
    const ageGyr = 10 ** rng.range(-1.3, 0.4);
    const richness = Math.floor(10 ** rng.range(1.7, 3));
    const coreRadiusPc = rng.range(1.5, 5);
    if (!keep) continue;
    groupMembers(
      rng,
      push,
      dx,
      dy,
      dz,
      coreRadiusPc,
      Math.min(300, Math.ceil(richness * imfFractionAbove(1.0))),
      1.0,
      ageGyr,
    );
  }

  return { nebulae, nebulaAtlas };
}

/** Chart border tracing: a local patch around home, matching the reach
 *  of the discrete star catalog — the chart maps where you can travel. */
const CHART_RADIUS_PC = 2800;
const CHART_STEP_PC = 90;
/** The disk's edge; the patch clips there if home sits near the rim. */
const DISK_EDGE_PC = 15200;

/**
 * Trace the gazetteer's territory borders: a lattice over the local
 * patch samples which territory each point belongs to, every border
 * crossing is sharpened by bisection along its lattice edge, and the
 * crossings connect through each lattice square — so the drawn curves
 * follow the warped Voronoi borders themselves, not the lattice.
 * Segments arrive in scene-frame parsecs; the home territory's own
 * outline ships separately so the chart can highlight "you are here".
 */
function buildSectorBounds(
  viewpoint: GalacticPosition,
  orientation: Float32Array,
): {
  sectorBounds: Float32Array;
  sectorHomeBounds: Float32Array;
  sectorLabels: SectorLabel[];
} {
  const n = Math.floor((2 * CHART_RADIUS_PC) / CHART_STEP_PC) + 1;
  const coordX = (i: number): number => viewpoint.xPc - CHART_RADIUS_PC + i * CHART_STEP_PC;
  const coordY = (j: number): number => viewpoint.yPc - CHART_RADIUS_PC + j * CHART_STEP_PC;
  const ids: bigint[] = new Array(n * n);
  const idAt = (i: number, j: number): bigint => {
    const key = j * n + i;
    let id = ids[key];
    if (id === undefined) {
      const xPc = coordX(i);
      const yPc = coordY(j);
      id =
        xPc * xPc + yPc * yPc > DISK_EDGE_PC * DISK_EDGE_PC
          ? -1n
          : sectorSeedAt({ xPc, yPc, zPc: 0 });
      ids[key] = id;
    }
    return id;
  };

  const homeId = sectorSeedAt({ xPc: viewpoint.xPc, yPc: viewpoint.yPc, zPc: 0 });
  // Crossing point per lattice edge (NaN pair when uncrossed).
  const crossH = new Float32Array(n * n * 2).fill(Number.NaN);
  const crossV = new Float32Array(n * n * 2).fill(Number.NaN);

  const bisect = (
    x0: number,
    y0: number,
    dx: number,
    dy: number,
    fromId: bigint,
  ): [number, number] => {
    let lo = 0;
    let hi = 1;
    for (let step = 0; step < 5; step++) {
      const mid = (lo + hi) / 2;
      const id = sectorSeedAt({ xPc: x0 + dx * mid, yPc: y0 + dy * mid, zPc: 0 });
      if (id === fromId) lo = mid;
      else hi = mid;
    }
    const t = (lo + hi) / 2;
    return [x0 + dx * t, y0 + dy * t];
  };

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const id = idAt(i, j);
      if (id === -1n) continue;
      if (i + 1 < n) {
        const right = idAt(i + 1, j);
        if (right !== id && right !== -1n) {
          const [x, y] = bisect(coordX(i), coordY(j), CHART_STEP_PC, 0, id);
          crossH[(j * n + i) * 2] = x;
          crossH[(j * n + i) * 2 + 1] = y;
        }
      }
      if (j + 1 < n) {
        const up = idAt(i, j + 1);
        if (up !== id && up !== -1n) {
          const [x, y] = bisect(coordX(i), coordY(j), 0, CHART_STEP_PC, id);
          crossV[(j * n + i) * 2] = x;
          crossV[(j * n + i) * 2 + 1] = y;
        }
      }
    }
  }

  const all: number[] = [];
  const home: number[] = [];
  const pushSegment = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    isHome: boolean,
  ): void => {
    const target = isHome ? home : all;
    target.push(
      ...rotateToScene(orientation, ax - viewpoint.xPc, ay - viewpoint.yPc, -viewpoint.zPc),
      ...rotateToScene(orientation, bx - viewpoint.xPc, by - viewpoint.yPc, -viewpoint.zPc),
    );
  };

  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const points: number[] = [];
      for (const [array, index] of [
        [crossH, (j * n + i) * 2],
        [crossH, ((j + 1) * n + i) * 2],
        [crossV, (j * n + i) * 2],
        [crossV, (j * n + i + 1) * 2],
      ] as Array<[Float32Array, number]>) {
        if (!Number.isNaN(array[index])) points.push(array[index], array[index + 1]);
      }
      if (points.length < 4) continue;
      const isHome =
        idAt(i, j) === homeId ||
        idAt(i + 1, j) === homeId ||
        idAt(i, j + 1) === homeId ||
        idAt(i + 1, j + 1) === homeId;
      if (points.length === 4) {
        pushSegment(points[0], points[1], points[2], points[3], isHome);
      } else {
        // Border junction inside the square: fan through its center.
        let cx = 0;
        let cy = 0;
        for (let p = 0; p < points.length; p += 2) {
          cx += points[p];
          cy += points[p + 1];
        }
        cx /= points.length / 2;
        cy /= points.length / 2;
        for (let p = 0; p < points.length; p += 2) {
          pushSegment(points[p], points[p + 1], cx, cy, isHome);
        }
      }
    }
  }

  // Label each province the slice shows near home, at its visible
  // centroid — naming exactly what the map draws.
  const centroids = new Map<bigint, { x: number; y: number; count: number }>();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const id = ids[j * n + i];
      if (id === undefined || id === -1n) continue;
      const entry = centroids.get(id) ?? { x: 0, y: 0, count: 0 };
      entry.x += coordX(i);
      entry.y += coordY(j);
      entry.count++;
      centroids.set(id, entry);
    }
  }
  const labels: SectorLabel[] = [];
  for (const [id, { x, y, count }] of centroids) {
    if (count < 4) continue;
    const cx = x / count;
    const cy = y / count;
    if (Math.hypot(cx - viewpoint.xPc, cy - viewpoint.yPc) > 2100 && id !== homeId) continue;
    const [sx, sy, sz] = rotateToScene(
      orientation,
      cx - viewpoint.xPc,
      cy - viewpoint.yPc,
      -viewpoint.zPc,
    );
    labels.push({ name: sectorNameForSeed(id), x: sx, y: sy, z: sz, home: id === homeId });
  }

  return {
    sectorBounds: new Float32Array(all),
    sectorHomeBounds: new Float32Array(home),
    sectorLabels: labels,
  };
}

/** Sky-chart direction lattice (marching resolution of the borders). */
const SKY_LON_STEPS = 160;
const SKY_LAT_STEPS = 80;
/** Border curves draw on a celestial sphere, star-map style; the
 *  radius is presentation, shrunk about home to fit the camera. */
const SKY_DRAW_RADIUS_PC = 800;
/** At most this many landmarks organize a sky. */
const CONSTELLATION_COUNT = 28;
/** No landmark is seated closer than this to another (rad). */
const CONSTELLATION_MIN_SEP = 0.15;
/** Seating margin, in Voronoi cost: a landmark joins only if it would
 *  hold its own heart against every seated anchor by at least this. */
const CONSTELLATION_MARGIN = 0.1;

interface SkyAnchor {
  seed: bigint;
  dir: [number, number, number];
  /** Angular half-size of the landmark's face on the sky (rad). */
  face: number;
  /** Reach beyond the face: grander landmarks claim more sky. */
  weight: number;
}

const angleBetween = (a: [number, number, number], b: [number, number, number]): number =>
  Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

/**
 * The constellations: the local sky cut into named regions around the
 * landmarks that actually organize it — the prominent nebulae and
 * rifts, which are the same first-class clouds the chart provinces
 * anchor on, so a sky region, the landmark at its heart, and the
 * province that landmark anchors all share one name. Human charts work
 * the same way (the Orion Nebula sits in Orion), and as on those
 * charts the cut is a viewpoint artifact: every home system letters
 * its own sky. Regions come from a prominence-weighted angular
 * Voronoi — each landmark owns its own face outright and reaches
 * beyond it by its stature, so the great complexes spread wide and the
 * borders settle organically between them.
 */
function buildConstellations(
  nebulae: NebulaPatch[],
  darkClouds: DarkCloudPatch[],
  orientation: Float32Array,
  starDirs: Float32Array,
  starBrightness: Float32Array,
  starSeeds: BigUint64Array,
): {
  constellationBounds: Float32Array;
  constellationLabels: SectorLabel[];
  bayerNames: Map<bigint, string>;
} {
  // One candidate per cloud — the lit and dark faces of the same
  // complex share a seed. Salience ranks the landmarks: angular size,
  // with emission counting beyond bulk, so a glowing nebula outranks a
  // dim rift of equal spread; geometry keeps the honest face.
  const bySeed = new Map<
    bigint,
    { dir: [number, number, number]; face: number; salience: number }
  >();
  const offer = (
    seed: bigint,
    dir: [number, number, number],
    face: number,
    salience: number,
  ): void => {
    const held = bySeed.get(seed);
    if (!held) bySeed.set(seed, { dir, face, salience });
    else {
      held.face = Math.max(held.face, face);
      held.salience = Math.max(held.salience, salience);
    }
  };
  for (const nebula of nebulae) {
    const face = nebula.angularRadius * 1.6;
    offer(nebula.seed, nebula.dir, face, face * (1 + 1.5 * Math.sqrt(nebula.brightness)));
  }
  for (const cloud of darkClouds) offer(cloud.seed, cloud.dir, cloud.halfExtent, cloud.halfExtent);
  const candidates = [...bySeed.entries()]
    .map(([seed, { dir, face, salience }]) => {
      const clamped = Math.min(face, 0.5);
      return {
        seed,
        dir,
        face: clamped,
        salience,
        weight: Math.min(1.9, Math.max(0.65, Math.cbrt(clamped / 0.15))),
      };
    })
    .sort((a, b) => b.salience - a.salience || (a.seed < b.seed ? -1 : 1));

  // Seat the landmarks in salience order. One that could no longer win
  // its own heart against the seated — or would letter on top of a
  // neighbor — stays a named object inside a greater constellation,
  // the way minor nebulae live inside Orion.
  const anchors: SkyAnchor[] = [];
  for (const candidate of candidates) {
    if (anchors.length >= CONSTELLATION_COUNT) break;
    const crowded = anchors.some((anchor) => {
      const angle = angleBetween(anchor.dir, candidate.dir);
      return (
        angle < CONSTELLATION_MIN_SEP ||
        (angle - anchor.face) / anchor.weight <
          -candidate.face / candidate.weight + CONSTELLATION_MARGIN
      );
    });
    if (crowded) continue;
    anchors.push(candidate);
  }
  if (anchors.length === 0) {
    return {
      constellationBounds: new Float32Array(0),
      constellationLabels: [],
      bayerNames: new Map(),
    };
  }

  /** The constellation a direction belongs to: negative inside a face,
   *  then edge distance scaled by stature — a power diagram on the sphere. */
  const idFor = (dir: [number, number, number]): bigint => {
    let best = anchors[0].seed;
    let bestCost = Infinity;
    for (const anchor of anchors) {
      const cost = (angleBetween(anchor.dir, dir) - anchor.face) / anchor.weight;
      if (cost < bestCost) {
        bestCost = cost;
        best = anchor.seed;
      }
    }
    return best;
  };

  // The Bayer garnish, exactly as Earth got its own: within each region
  // of this sky, the brightest glint that answers to a name is its α.
  // Viewpoint-local by nature — every home system letters its own.
  const brightestPerRegion = new Map<bigint, { seed: bigint; brightness: number }>();
  for (let i = 0; i < starSeeds.length; i++) {
    const seed = starSeeds[i];
    if (seed === 0n) continue;
    const brightness = starBrightness[i];
    const id = idFor([starDirs[i * 3], starDirs[i * 3 + 1], starDirs[i * 3 + 2]]);
    const region = brightestPerRegion.get(id);
    if (!region) brightestPerRegion.set(id, { seed, brightness });
    else if (brightness > region.brightness) {
      region.seed = seed;
      region.brightness = brightness;
    }
  }
  const bayerNames = new Map<bigint, string>();
  for (const [id, { seed }] of brightestPerRegion) {
    bayerNames.set(seed, `α ${sectorNameForSeed(id)}`);
  }

  const dirAt = (i: number, j: number): [number, number, number] => {
    const latitude = (((j + 0.5) / SKY_LAT_STEPS) - 0.5) * Math.PI;
    const longitude = (((i % SKY_LON_STEPS) + 0.5) / SKY_LON_STEPS) * 2 * Math.PI;
    const cosLat = Math.cos(latitude);
    return [cosLat * Math.cos(longitude), cosLat * Math.sin(longitude), Math.sin(latitude)];
  };

  const ids: bigint[] = new Array(SKY_LON_STEPS * SKY_LAT_STEPS);
  for (let j = 0; j < SKY_LAT_STEPS; j++) {
    for (let i = 0; i < SKY_LON_STEPS; i++) {
      ids[j * SKY_LON_STEPS + i] = idFor(dirAt(i, j));
    }
  }

  // A name per region at its solid-angle-weighted center direction;
  // sliver regions go unlettered rather than cramped.
  const regionSums = new Map<
    bigint,
    { x: number; y: number; z: number; weight: number }
  >();
  let totalWeight = 0;
  for (let j = 0; j < SKY_LAT_STEPS; j++) {
    const weight = Math.cos((((j + 0.5) / SKY_LAT_STEPS) - 0.5) * Math.PI);
    for (let i = 0; i < SKY_LON_STEPS; i++) {
      const id = ids[j * SKY_LON_STEPS + i];
      totalWeight += weight;
      const dir = dirAt(i, j);
      const entry = regionSums.get(id) ?? { x: 0, y: 0, z: 0, weight: 0 };
      entry.x += dir[0] * weight;
      entry.y += dir[1] * weight;
      entry.z += dir[2] * weight;
      entry.weight += weight;
      regionSums.set(id, entry);
    }
  }
  const constellationLabels: SectorLabel[] = [];
  for (const [id, sum] of regionSums) {
    if (sum.weight < totalWeight * 0.005) continue;
    const length = Math.hypot(sum.x, sum.y, sum.z);
    if (length < 1e-6) continue;
    const [sx, sy, sz] = rotateToScene(
      orientation,
      (sum.x / length) * SKY_DRAW_RADIUS_PC,
      (sum.y / length) * SKY_DRAW_RADIUS_PC,
      (sum.z / length) * SKY_DRAW_RADIUS_PC,
    );
    constellationLabels.push({ name: sectorNameForSeed(id), x: sx, y: sy, z: sz, home: false });
  }

  // Border crossing between two adjacent sight-lines, bisected in
  // direction and drawn on the celestial sphere.
  const mix = (
    a: [number, number, number],
    b: [number, number, number],
    t: number,
  ): [number, number, number] => {
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    const z = a[2] + (b[2] - a[2]) * t;
    const length = Math.hypot(x, y, z) || 1;
    return [x / length, y / length, z / length];
  };
  const crossingPoint = (
    a: [number, number, number],
    idA: bigint,
    b: [number, number, number],
  ): [number, number, number] => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 4; i++) {
      const mid = (lo + hi) / 2;
      if (idFor(mix(a, b, mid)) === idA) lo = mid;
      else hi = mid;
    }
    const dir = mix(a, b, (lo + hi) / 2);
    return [
      dir[0] * SKY_DRAW_RADIUS_PC,
      dir[1] * SKY_DRAW_RADIUS_PC,
      dir[2] * SKY_DRAW_RADIUS_PC,
    ];
  };

  const crossLon: Array<[number, number, number] | null> = new Array(
    SKY_LON_STEPS * SKY_LAT_STEPS,
  ).fill(null);
  const crossLat: Array<[number, number, number] | null> = new Array(
    SKY_LON_STEPS * SKY_LAT_STEPS,
  ).fill(null);
  for (let j = 0; j < SKY_LAT_STEPS; j++) {
    for (let i = 0; i < SKY_LON_STEPS; i++) {
      const id = ids[j * SKY_LON_STEPS + i];
      const right = ids[j * SKY_LON_STEPS + ((i + 1) % SKY_LON_STEPS)];
      if (right !== id) {
        crossLon[j * SKY_LON_STEPS + i] = crossingPoint(dirAt(i, j), id, dirAt(i + 1, j));
      }
      if (j + 1 < SKY_LAT_STEPS) {
        const up = ids[(j + 1) * SKY_LON_STEPS + i];
        if (up !== id) {
          crossLat[j * SKY_LON_STEPS + i] = crossingPoint(dirAt(i, j), id, dirAt(i, j + 1));
        }
      }
    }
  }

  const segments: number[] = [];
  const push = (p: [number, number, number]): void => {
    segments.push(...rotateToScene(orientation, p[0], p[1], p[2]));
  };
  for (let j = 0; j < SKY_LAT_STEPS - 1; j++) {
    for (let i = 0; i < SKY_LON_STEPS; i++) {
      const points = [
        crossLon[j * SKY_LON_STEPS + i],
        crossLon[(j + 1) * SKY_LON_STEPS + i],
        crossLat[j * SKY_LON_STEPS + i],
        crossLat[j * SKY_LON_STEPS + ((i + 1) % SKY_LON_STEPS)],
      ].filter((p): p is [number, number, number] => p !== null);
      if (points.length < 2) continue;
      if (points.length === 2) {
        push(points[0]);
        push(points[1]);
      } else {
        const center: [number, number, number] = [0, 0, 0];
        for (const p of points) {
          center[0] += p[0] / points.length;
          center[1] += p[1] / points.length;
          center[2] += p[2] / points.length;
        }
        for (const p of points) {
          push(p);
          push(center);
        }
      }
    }
  }
  return { constellationBounds: new Float32Array(segments), constellationLabels, bayerNames };
}

/**
 * Mean stellar luminosity per star of the reference field population,
 * derived from the IMF and the home population mix rather than assumed:
 * stratified quadrature over a log-mass grid crossed with a stratified
 * sweep of the population's age CDF. The bright tail — rare massive
 * stars and giants — carries most of the light, so sparse age sampling
 * is lethal here: a 12-draw local estimate once swung the galaxy's
 * brightness 50× between locales. One fixed, well-sampled constant —
 * how bright the galaxy is cannot depend on who is looking at it.
 */
let meanLumMemo = 0;

export function meanPopulationLuminosity(): number {
  if (meanLumMemo > 0) return meanLumMemo;
  const ages: number[] = [];
  const strata = 96;
  for (let i = 0; i < strata; i++) {
    ages.push(populationFromUnit((i + 0.5) / strata, HOME_POSITION).ageGyr);
  }

  const bins = 48;
  let weightSum = 0;
  let lumSum = 0;
  for (let b = 0; b < bins; b++) {
    const m0 = 0.08 * (120 / 0.08) ** (b / bins);
    const m1 = 0.08 * (120 / 0.08) ** ((b + 1) / bins);
    const weight = imfFractionAbove(m0) - imfFractionAbove(m1);
    const mass = Math.sqrt(m0 * m1);
    let lum = 0;
    for (const age of ages) lum += evolve(mass, age).luminosity;
    lumSum += (weight * lum) / ages.length;
    weightSum += weight;
  }
  meanLumMemo = lumSum / Math.max(weightSum, 1e-9);
  return meanLumMemo;
}

/** Clouds inside this radius shadow the sky individually. */
const RIFT_NEAR_PC = 1500;

/** In-plane visual opacity, shared by every dust consumer. */
const DUST_KAPPA = 0.045;

/**
 * The prominent nearby dark clouds, done exactly like the nebulae: each
 * ray-marches a tangent-plane sprite through its own density field —
 * accumulating optical depth instead of emission — so its shadow gets
 * per-object resolution instead of lat-long texels.
 */
function buildDarkClouds(
  viewpoint: GalacticPosition,
  dustKappa: number,
): { darkClouds: DarkCloudPatch[]; darkAtlas: Float32Array; spriteSeeds: Set<bigint> } {
  const candidates: Array<{ cloud: MolecularCloud; angular: number; distance: number }> = [];
  for (const cloud of cloudsNear(viewpoint, RIFT_NEAR_PC)) {
    const dx = cloud.positionPc.xPc - viewpoint.xPc;
    const dy = cloud.positionPc.yPc - viewpoint.yPc;
    const dz = cloud.positionPc.zPc - viewpoint.zPc;
    const distance = Math.hypot(dx, dy, dz);
    const reach = cloudReachPc(cloud);
    if (distance < reach * 1.05) continue;
    const angular = reach / distance;
    if (angular > 1.0) continue;
    candidates.push({ cloud, angular: angular * Math.sqrt(cloud.amplitude), distance });
  }
  candidates.sort((a, b) => b.angular - a.angular);
  const kept = candidates.slice(0, DARK_ATLAS_COLS * DARK_ATLAS_ROWS);

  const darkAtlas = new Float32Array(
    DARK_ATLAS_COLS * DARK_TILE * DARK_ATLAS_ROWS * DARK_TILE,
  ).fill(1);
  const spriteSeeds = new Set<bigint>();
  const atlasWidth = DARK_ATLAS_COLS * DARK_TILE;

  const darkClouds: DarkCloudPatch[] = kept.map(({ cloud, distance }, tile) => {
    spriteSeeds.add(cloud.seed);
    const dx = cloud.positionPc.xPc - viewpoint.xPc;
    const dy = cloud.positionPc.yPc - viewpoint.yPc;
    const dz = cloud.positionPc.zPc - viewpoint.zPc;
    const view: [number, number, number] = [dx / distance, dy / distance, dz / distance];
    const axis: [number, number, number] = Math.abs(view[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const right = normalize(cross(view, axis));
    const up = cross(view, right);

    const reachPc = cloudReachPc(cloud);
    const dustFactor = cloudDustFactor(cloud) * dustKappa;
    const steps = 12;
    const ds = (2 * reachPc) / steps;
    const tileX = (tile % DARK_ATLAS_COLS) * DARK_TILE;
    const tileY = Math.floor(tile / DARK_ATLAS_COLS) * DARK_TILE;

    for (let j = 1; j < DARK_TILE - 1; j++) {
      for (let i = 1; i < DARK_TILE - 1; i++) {
        const u = ((i + 0.5) / DARK_TILE) * 2 - 1;
        const v = ((j + 0.5) / DARK_TILE) * 2 - 1;
        const ox = (right[0] * u + up[0] * v) * reachPc;
        const oy = (right[1] * u + up[1] * v) * reachPc;
        const oz = (right[2] * u + up[2] * v) * reachPc;
        let tau = 0;
        for (let s = 0; s < steps; s++) {
          const t = -reachPc + (s + 0.5) * ds;
          tau += cloudLocalDensity(
            cloud,
            ox + view[0] * t,
            oy + view[1] * t,
            oz + view[2] * t,
          );
        }
        tau *= dustFactor * ds;
        if (tau > 0) {
          darkAtlas[(tileY + j) * atlasWidth + tileX + i] = Math.exp(-tau);
        }
      }
    }

    return {
      seed: cloud.seed,
      distancePc: distance,
      dir: view,
      halfExtent: reachPc / distance,
      right,
      up,
      tile,
    };
  });

  return { darkClouds, darkAtlas, spriteSeeds };
}

/**
 * Transmission through the remaining small clouds, texel-exact on the
 * lat-long map: each projects its footprint and only those texels march
 * its density field. The prominent clouds are excluded — they carry
 * their own sprites.
 */
function buildCloudTransmission(
  viewpoint: GalacticPosition,
  dustKappa: number,
  excluded: Set<bigint>,
): Float32Array {
  const transmission = new Float32Array(RIFT_WIDTH * RIFT_HEIGHT).fill(1);
  const rowRad = Math.PI / RIFT_HEIGHT;
  const colRad = (2 * Math.PI) / RIFT_WIDTH;

  for (const cloud of cloudsNear(viewpoint, RIFT_NEAR_PC)) {
    if (excluded.has(cloud.seed)) continue;
    const dx = cloud.positionPc.xPc - viewpoint.xPc;
    const dy = cloud.positionPc.yPc - viewpoint.yPc;
    const dz = cloud.positionPc.zPc - viewpoint.zPc;
    const distance = Math.hypot(dx, dy, dz);
    const reachPc = cloudReachPc(cloud);
    // Inside or engulfing the sky: no meaningful footprint to rasterize.
    if (distance < reachPc || distance < 1) continue;
    const angRad = Math.asin(Math.min(1, reachPc / distance));
    if (angRad > 1.0) continue;

    const dustFactor = cloudDustFactor(cloud) * dustKappa;
    const lat0 = Math.asin(dz / distance);
    const lon0 = Math.atan2(dy, dx);
    const row0 = Math.max(0, Math.floor((lat0 - angRad + Math.PI / 2) / rowRad));
    const row1 = Math.min(RIFT_HEIGHT - 1, Math.ceil((lat0 + angRad + Math.PI / 2) / rowRad));
    const steps = 9;
    const ds = (2 * reachPc) / steps;

    for (let row = row0; row <= row1; row++) {
      const latitude = (row + 0.5) * rowRad - Math.PI / 2;
      const cosLat = Math.cos(latitude);
      const lonHalf = Math.min(Math.PI, angRad / Math.max(cosLat, 0.03));
      const col0 = Math.floor((lon0 - lonHalf) / colRad);
      const col1 = Math.ceil((lon0 + lonHalf) / colRad);
      for (let c = col0; c <= col1; c++) {
        const column = ((c % RIFT_WIDTH) + RIFT_WIDTH) % RIFT_WIDTH;
        const longitude = (column + 0.5) * colRad;
        const vx = cosLat * Math.cos(longitude);
        const vy = cosLat * Math.sin(longitude);
        const vz = Math.sin(latitude);
        // Quick cone rejection before marching.
        const cosSep = (vx * dx + vy * dy + vz * dz) / distance;
        if (cosSep < Math.cos(angRad)) continue;

        let tau = 0;
        for (let k = 0; k < steps; k++) {
          const s = distance - reachPc + (k + 0.5) * ds;
          tau +=
            cloudLocalDensity(
              cloud,
              viewpoint.xPc + vx * s - cloud.positionPc.xPc,
              viewpoint.yPc + vy * s - cloud.positionPc.yPc,
              viewpoint.zPc + vz * s - cloud.positionPc.zPc,
            ) *
            dustFactor *
            ds;
        }
        if (tau > 0) transmission[row * RIFT_WIDTH + column] *= Math.exp(-tau);
      }
    }
  }
  return transmission;
}

/**
 * Line-of-sight integration of unresolved starlight through the dust
 * disk. The visible band is dominated by the nearest kiloparsec or two —
 * that proximity is what makes it broad and soft — so integration starts
 * close in with log-spaced steps. Extinction carries a physical in-plane
 * opacity (~1 mag/kpc locally, so the galactic center sits dozens of
 * optical depths deep), and the clumped half of the dust lives in the
 * molecular-cloud population: every dark rift in the band is a specific
 * cloud, the same objects that host the nebulae.
 */
function buildGlow(
  viewpoint: GalacticPosition,
  spriteSeeds: Set<bigint>,
  onProgress?: (fraction: number) => void,
): {
  glowWidth: number;
  glowHeight: number;
  glowData: Float32Array;
  skyFloorRadiance: number;
  riftData: Float32Array;
} {
  const width = 256;
  const height = 128;
  const data = new Float32Array(width * height * 4);
  const radiance = new Float32Array(width * height);
  const reddenings = new Float32Array(width * height);
  const startPc = 80;
  const endPc = 25000;
  const meanLuminosity = meanPopulationLuminosity();
  const dustKappa = DUST_KAPPA;

  for (let row = 0; row < height; row++) {
    if ((row & 15) === 0) onProgress?.(row / height);
    const latitude = ((row + 0.5) / height - 0.5) * Math.PI;
    for (let column = 0; column < width; column++) {
      const longitude = ((column + 0.5) / width) * 2 * Math.PI;
      const dirX = Math.cos(latitude) * Math.cos(longitude);
      const dirY = Math.cos(latitude) * Math.sin(longitude);
      const dirZ = Math.sin(latitude);

      let light = 0;
      let opticalDepth = 0;
      for (let s = startPc; s < endPc; s += Math.max(90, s * 0.11)) {
        const stepPc = Math.max(90, s * 0.11);
        const position = {
          xPc: viewpoint.xPc + dirX * s,
          yPc: viewpoint.yPc + dirY * s,
          zPc: viewpoint.zPc + dirZ * s,
        };
        // Diffuse dust here; nearby clouds are carried by the sharp
        // per-cloud transmission map instead, so this base map stays
        // smooth at its texel scale. Distant clouds are sub-texel and
        // sub-step: they enter at their expected field — sampling
        // individual clouds out there is shot noise, not structure.
        const sample = sightlineDensities(position);
        const clump =
          s > RIFT_NEAR_PC ? 0.45 + 1.6 * expectedCloudField(sample.dust, sample.armBoost) : 0.45;
        opticalDepth += sample.dust * clump * dustKappa * stepPc;
        // The arm overdensity shines young: its light is weighted by
        // ARM_YOUNG_LIGHT beyond its star count.
        const armExtra = sample.armBoost - 1;
        const thinLit = (sample.thin / sample.armBoost) * (1 + ARM_YOUNG_LIGHT * armExtra);
        light +=
          (thinLit + sample.thick + sample.halo) *
          meanLuminosity *
          stepPc *
          Math.exp(-opticalDepth);
      }

      // Dust reddens as well as dims; warm population base color.
      reddenings[row * width + column] = Math.exp(-opticalDepth * 0.25);
      // The column is luminosity density integrated down the ray,
      // L☉/pc²; over the 4π it shines into, that is its radiance.
      radiance[row * width + column] = light / (4 * Math.PI);
    }
  }

  // The map carries the physics — column radiance and reddening — and
  // the display law is the shader's, where the instrument can change.
  // What is measured here is the sky's own floor: the darkest column,
  // about a solar luminosity per pc² per steradian toward the poles
  // (the integrated starlight of the whole ray), which every deep
  // exposure subtracts before showing structure as contrast above it.
  // Self-calibrated at every viewpoint, no dial; the nebula tiers
  // subtract the same floor.
  let floor = Infinity;
  for (let index = 0; index < width * height; index++) {
    if (radiance[index] < floor) floor = radiance[index];
  }
  for (let index = 0; index < width * height; index++) {
    data[index * 4] = radiance[index];
    data[index * 4 + 1] = reddenings[index];
    data[index * 4 + 2] = 0;
    data[index * 4 + 3] = 1;
  }
  return {
    glowWidth: width,
    glowHeight: height,
    glowData: data,
    skyFloorRadiance: floor,
    riftData: buildCloudTransmission(viewpoint, dustKappa, spriteSeeds),
  };
}
