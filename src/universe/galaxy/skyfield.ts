import { LOCAL_CLOUD_RADIUS_PC } from './globalDust';
import { stellarBandRgb } from '../../core/color/stellarLight';
import { rgbLuminance } from '../../core/color/optical';
import { cellEmissionWeight } from '../../core/physics/radiativeTransfer';
import { integrateGalaxyGlowRay } from './glowRay';
import { type NebulaPortrait, nebulaPortraitPhotometry, nebulaPortrait, nebulaRayInterval, sampleNebulaPortrait } from './nebulaPortrait';
import type { NebulaVolumeBake } from './nebulaVolume';
import { nebulaSpriteLuminosities } from './nebulaPhotometry';
import { blackbodyLinearRgb } from '../../core/color/blackbody';
import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { KROUPA_SEGMENTS } from '../star/imf';
import { CATALOG_ROWS } from './catalog';
import {
  cloudDustFactor,
  cloudLocalDensity,
  cloudReachPc,
  cloudsNear,
  ENVELOPE_REACH,
  type MolecularCloud,
} from './clouds';
import {
  DUST_OPACITY_PER_PC,
  dustDensity,
  HOME_POSITION,
  stellarDensity,
  type GalacticPosition,
} from './density';
import {
  nebulaEmissionShare,
  nebulaFor,
  nebulaIlluminant,
  nebulaLightSolar,
  type Nebula,
} from './nebula';
import { NEBULA_MEAN_U, nebulaEmissionColor, nebulaNarrowbandColor } from './nebulaLines';
import { displaySurfaceBrightness } from './displayLaw';
import { SCATTER_TINT_RGB } from './dustScattering';
import { rotateToScene, sceneFromGalaxy } from './orientation';
import { populationFromUnit } from './population';
import { appendPacked, makeAccum, packAccum, pushTo, type PackedStars, type SweepSlab } from './skyStars';
import { MIN_FAR_IRRADIANCE, sweepRow } from './skySurvey';
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
 *  into visible blocks. Physical grid refinement dominates generation;
 *  finished tiles stream independently into these fixed slots. */
export const NEBULA_TILE = 128;
export const NEBULA_ATLAS_COLS = 8;
export const NEBULA_ATLAS_ROWS = 6;

/** The Milky Way glow map's lat–long resolution. */
export const GLOW_WIDTH = 256;
export const GLOW_HEIGHT = 128;

/** Cloud-shadow transmission map resolution (4× the glow map). */
export const RIFT_WIDTH = 768;
export const RIFT_HEIGHT = 384;

/** One dark-cloud tile's frame: the cloud, and the tangent basis the
 *  tile is marched in. */
export interface DarkTileJob {
  cloud: MolecularCloud;
  view: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
}

/** One lit cloud's sprite tile: the object, the tangent basis the
 *  tile is marched in and the half-extent it spans. */
export interface NebulaTileJob {
  /** Already solved by the shared pool, when this is a streamed tile. */
  portrait?: NebulaPortrait;
  cloud: MolecularCloud;
  nebula: Nebula;
  view: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  extentPc: number;
}

/**
 * A renderer of the sky's background maps — the glow, the rift
 * transmission, the dark-cloud tiles and the nebula tiles' march —
 * that a worker with a GPU can offer in place of the CPU loops below.
 * Each returns exactly the array the CPU builder would have: the glow
 * as RGBA texels (radiance, reddening, 0, 1), the transmissions as one
 * float per texel, the nebula march as the atlas-shaped RGBA field
 * marchNebulaTile fills per tile. The CPU builders stay the authority;
 * a baker mirrors them.
 */
export interface SkyMapBaker {
  glow(viewpoint: GalacticPosition): Float32Array;
  rift(viewpoint: GalacticPosition, clouds: MolecularCloud[]): Float32Array;
  darkTiles(jobs: DarkTileJob[]): Float32Array;
  nebulaTiles(jobs: NebulaTileJob[], onProgress?: (completed: number, total: number) => void): Float32Array;
  dispose(): void;
}

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
  viewpointPc?: GalacticPosition;
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
  /** Lat-long optical-power RGB radiance (L☉ pc⁻² sr⁻¹), alpha 1.
   *  Population spectra and path-dependent extinction precede display. */
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
  const slabs: SweepSlab[] = [];
  CATALOG_ROWS.forEach((row, rowIndex) => {
    const weight = rowWeights[rowIndex];
    const stage = rowStageName(row);
    onProgress?.(0.84 * rowsBehind, stage, 0);
    slabs.push(
      sweepRow(row, rowIndex, viewpoint, (fraction) =>
        onProgress?.(0.84 * (rowsBehind + weight * fraction), stage, fraction),
      ),
    );
    rowsBehind += weight;
  });
  return assembleSkyField(viewpoint, seed, slabs, onProgress);
}

/** Per-row share of the star sweep, for progress weighting. */
export function catalogRowWeights(): number[] {
  return CATALOG_ROWS.length === ROW_PROGRESS_WEIGHTS.length
    ? ROW_PROGRESS_WEIGHTS
    : CATALOG_ROWS.map(() => 1 / CATALOG_ROWS.length);
}

/**
 * The half of a sky that the star sweep has no say in: where the gas
 * and dust are, where the chart borders run, and how bright the
 * unresolved background is in every direction. Built beside the sweep
 * rather than after it, and shown as soon as it lands.
 */
export interface SkyBackground {
  viewpointPc?: GalacticPosition;
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
  baker: SkyMapBaker | null = null,
  onBase?: (background: SkyBackground) => void,
  onPortrait?: (update: SkyPortraitUpdate) => void,
): SkyBackground {
  const { background, jobs } = planSkyBackground(viewpoint, seed,
    (fraction, stage, step) => onProgress?.(0.1 * fraction, stage, step), baker);
  onBase?.(background);
  onProgress?.(0.1, `nebulae 0/${jobs.length}`, 0);
  for (let tile = 0; tile < jobs.length; tile++) {
    const patch = buildNebulaPatch(jobs[tile], tile, background.nebulaAtlas, baker);
    background.nebulae[tile] = patch;
    onPortrait?.({ patch, pixels: nebulaTileFromAtlas(background.nebulaAtlas, tile) });
    onProgress?.(0.1 + 0.9 * (tile + 1) / jobs.length, `nebulae ${tile + 1}/${jobs.length}`, (tile + 1) / jobs.length);
  }
  return background;
}

export interface SkyPortraitUpdate { patch: NebulaPatch; pixels: Float32Array }

/** Cheap, complete diffuse sky and deterministic empty portrait slots. */
export function planSkyBackground(
  viewpoint: GalacticPosition, seed = 0n, onProgress?: SkyProgress, baker: SkyMapBaker | null = null,
): { background: SkyBackground; jobs: NebulaCandidate[] } {
  const groupStars = makeAccum();
  const push: PushStar = (dx, dy, dz, luminosity, tEff) =>
    pushTo(groupStars, dx, dy, dz, luminosity, tEff, 0n);

  const jobs = planGroups(viewpoint, push);
  const nebulae = jobs.map((candidate, tile) => nebulaPlaceholder(candidate, tile));
  const nebulaAtlas = new Float32Array(NEBULA_ATLAS_COLS * NEBULA_TILE * NEBULA_ATLAS_ROWS * NEBULA_TILE * 4);
  onProgress?.(0, 'dark clouds', -1);
  const { darkClouds, darkAtlas, spriteSeeds } = buildDarkClouds(viewpoint, DUST_KAPPA, baker);
  onProgress?.(0.3, 'charting', -1);
  const bounds = buildSectorBounds(viewpoint, sceneFromGalaxy(seed));
  const glow = buildGlow(
    viewpoint,
    spriteSeeds,
    (fraction) => onProgress?.(0.4 + 0.6 * fraction, 'milky way glow', fraction),
    baker,
  );

  return { jobs, background: {
    viewpointPc: viewpoint,
    nebulae,
    nebulaAtlas,
    darkClouds,
    darkAtlas,
    groupStars: packAccum(groupStars),
    sceneFromGalaxy: sceneFromGalaxy(seed),
    ...bounds,
    ...glow,
  } };
}

/**
 * Everything after the star sweep: group stars and nebulae, dark
 * clouds, charts, and the glow — assembled onto the merged sweep
 * slabs, which must arrive in sweep order.
 */
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
    viewpointPc: viewpoint,
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

/** The natal group as sky: each member where it stands in its cloud,
 * pushed if it resolves from here. */
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
    if (rgbLuminance(stellarBandRgb(member.luminosity,member.tEff)) / distanceSq < MIN_FAR_IRRADIANCE) continue;
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
function nebulaHues(nebula: Nebula, view?: readonly number[]): {
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
  const measured = nebulaPortraitPhotometry(nebula, view), lum = measured.luminosities;
  return { emission: [er, eg, eb], reflection: measured.reflectionHue,
    share: lum.lines / (lum.lines + lum.scattered || 1) };
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

/** The frame a cloud's tile is marched in: a tangent basis about the
 *  view direction, and the half-extent that covers the whole body — a
 *  drawn-out cloud reaches past its nominal radius along its long axis,
 *  and a tile sized to the radius alone would slice it off in a
 *  straight line. */
export function nebulaTileFrame(
  cloud: MolecularCloud,
  view: [number, number, number],
): { right: [number, number, number]; up: [number, number, number]; extentPc: number } {
  const axis: [number, number, number] =
    Math.abs(view[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const right = normalize(cross(view, axis));
  return { right, up: cross(view, right), extentPc: cloudReachPc(cloud) };
}

/** Match each nested cell scale along the ray; never skip a small fine
 * bubble by stepping at the outer cloud's scale. */
export const NEBULA_TILE_MAX_STEPS = 128;

/** Integrate the same solved gas, ionization and source-column shadows
 * as the near volume. RGBA = extincted line/scatter, free line/scatter. */
export function marchNebulaTile(job: NebulaTileJob): Float32Array {
  const { nebula, view, right, up, extentPc } = job;
  const pair = job.portrait ?? nebulaPortrait(nebula);
  nebulaPortraitPhotometry(nebula, view, pair);
  const marched = new Float32Array(NEBULA_TILE * NEBULA_TILE * 4);
  const value = new Float64Array(4);
  for (let j = 1; j < NEBULA_TILE - 1; j++) for (let i = 1; i < NEBULA_TILE - 1; i++) {
    const u = ((i + 0.5) / NEBULA_TILE) * 2 - 1, v = ((j + 0.5) / NEBULA_TILE) * 2 - 1;
    const origin = right.map((r, axis) => (r * u + up[axis] * v) * extentPc);
    const [near, far] = nebulaRayInterval(pair.coarse, origin, view);
    if (far <= near) continue;
    let tau = 0, line = 0, scatter = 0, lineFree = 0, scatterFree = 0;
    const integrate = (bake: NebulaVolumeBake, start: number, end: number) => {
      if (end <= start) return;
      // A near-integer chord needs the same count after GPU float
      // rounding; changing 50 to 51 otherwise shifts every sample.
      const count = Math.min(NEBULA_TILE_MAX_STEPS, Math.max(1, Math.ceil((end - start) / (2 * bake.halfExtentsPc[0] / bake.size) * (1 - 2e-6))));
      const dt = (end - start) / count;
      for (let step = 0; step < count; step++) {
        const t = start + (step + 0.5) * dt;
        sampleNebulaPortrait(bake, origin[0] + view[0] * t, origin[1] + view[1] * t, origin[2] + view[2] * t, value, view);
        const depth = value[0] * DUST_OPACITY_PER_PC * dt;
        const transmitted = Math.exp(-tau) * cellEmissionWeight(depth);
        line += value[1] * dt * transmitted; scatter += value[2] * dt * transmitted;
        lineFree += value[1] * dt; scatterFree += value[2] * dt; tau += depth;
      }
    };
    const inner = pair.fine ? nebulaRayInterval(pair.fine, origin, view) : [0, 0];
    if (pair.fine && inner[1] > inner[0]) {
      integrate(pair.coarse, near, inner[0]); integrate(pair.fine, inner[0], inner[1]); integrate(pair.coarse, inner[1], far);
    } else integrate(pair.coarse, near, far);
    marched.set([line, scatter, lineFree, scatterFree], (j * NEBULA_TILE + i) * 4);
  }
  return marched;
}

/** One tile's march cut from an atlas-shaped field, as
 *  marchNebulaTile lays it out. */
export function nebulaTileFromAtlas(field: Float32Array, tile: number): Float32Array {
  const atlasWidth = NEBULA_ATLAS_COLS * NEBULA_TILE;
  const tileX = (tile % NEBULA_ATLAS_COLS) * NEBULA_TILE;
  const tileY = Math.floor(tile / NEBULA_ATLAS_COLS) * NEBULA_TILE;
  const marched = new Float32Array(NEBULA_TILE * NEBULA_TILE * 4);
  for (let j = 0; j < NEBULA_TILE; j++) {
    const from = ((tileY + j) * atlasWidth + tileX) * 4;
    marched.set(field.subarray(from, from + NEBULA_TILE * 4), j * NEBULA_TILE * 4);
  }
  return marched;
}

/**
 * Close a marched tile on transport-derived luminosities and write it into the atlas.
 * Each mechanism closes on its own: its emitted light crosses this tile,
 * so the radiance at a pixel follows from flux closure — luminosity
 * over 4πd² spread by the tile's own integral — and the distance
 * cancels, as it must: surface brightness carries none. Spread by the
 * unextinguished integral, so what the tile shows is the budget less
 * what the cloud's own dust took on the way out. The tile carries
 * physics, not pixels: relative luminance and the local line-vs-
 * scattered mix, and the sky shader colours and exposes them under
 * whatever instrument is standing — so a mode change never re-bakes a
 * sky.
 */
export function renderNebulaTile(
  atlas: Float32Array,
  tile: number,
  cloud: MolecularCloud,
  view: [number, number, number],
  nebula: Nebula,
  marched: Float32Array = marchNebulaTile({ cloud, nebula, view, ...nebulaTileFrame(cloud, view) }),
): {
  right: [number, number, number];
  up: [number, number, number];
  peakRadiance: number;
  /** The share of the object's light that leaves it toward this
   *  viewpoint, its own dust having eaten the rest. */
  escaped: number;
} {
  const { right, up, extentPc } = nebulaTileFrame(cloud, view);
  const atlasWidth = NEBULA_ATLAS_COLS * NEBULA_TILE;
  const tileX = (tile % NEBULA_ATLAS_COLS) * NEBULA_TILE;
  const tileY = Math.floor(tile / NEBULA_ATLAS_COLS) * NEBULA_TILE;

  let lineSum = 0;
  let scatterSum = 0;
  let lineFree = 0;
  let scatterFree = 0;
  for (let at = 0; at < marched.length; at += 4) {
    lineSum += marched[at];
    scatterSum += marched[at + 1];
    lineFree += marched[at + 2];
    scatterFree += marched[at + 3];
  }
  const closure = NEBULA_TILE ** 2 / (16 * Math.PI * extentPc ** 2);
  const { lines: lineLum, scattered: scatterLum } = nebulaPortraitPhotometry(nebula, view).luminosities;
  const lineScale = lineFree > 0 ? (lineLum * closure) / lineFree : 0;
  const scatterScale = scatterFree > 0 ? (scatterLum * closure) / scatterFree : 0;
  const escaped =
    lineLum + scatterLum > 0
      ? (lineLum * (lineFree > 0 ? lineSum / lineFree : 0) +
          scatterLum * (scatterFree > 0 ? scatterSum / scatterFree : 0)) /
        (lineLum + scatterLum)
      : 0;
  let peak = 1e-6;
  for (let at = 0; at < marched.length; at += 4) {
    const radiance = lineScale * marched[at] + scatterScale * marched[at + 1];
    if (radiance > peak) peak = radiance;
  }
  for (let j = 0; j < NEBULA_TILE; j++) {
    for (let i = 0; i < NEBULA_TILE; i++) {
      const at = (j * NEBULA_TILE + i) * 4;
      const dst = ((tileY + j) * atlasWidth + tileX + i) * 4;
      const lines = lineScale * marched[at];
      const radiance = lines + scatterScale * marched[at + 1];
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

export interface NebulaCandidate {
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
function planGroups(
  viewpoint: GalacticPosition,
  push: PushStar,
): NebulaCandidate[] {
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

  // The atlas holds the brightest; ray-march only those — in one pass
  // where a baker stands, tile by tile on the CPU otherwise.
  candidates.sort((a, b) => b.fluxSolar - a.fluxSolar);
  const kept = candidates.slice(0, NEBULA_ATLAS_COLS * NEBULA_ATLAS_ROWS);

  // The old observer-centred dispersed clusters duplicated the field
  // population and changed location on travel. Associations must be a
  // spatial redistribution of catalogue members before returning here.

  return kept;
}

/** Fixed geometry with zero light until its measured portrait arrives. */
function nebulaPlaceholder(candidate: NebulaCandidate, tile: number): NebulaPatch {
  const { right, up } = nebulaTileFrame(candidate.cloud, candidate.view);
  return { seed: candidate.cloud.seed, distancePc: candidate.distancePc, dir: candidate.view,
    angularRadius: Math.min(0.35, cloudReachPc(candidate.cloud) / ENVELOPE_REACH / candidate.distancePc),
    color: [0, 0, 0], brightness: 0, peakRadiance: 0, emissionHue: [0, 0, 0],
    emissionHueNarrow: [0, 0, 0], reflectionHue: [0, 0, 0], right, up, tile };
}

export function buildNebulaPatch(candidate: NebulaCandidate, tile: number, atlas: Float32Array, baker: SkyMapBaker | null = null, portrait?: NebulaPortrait): NebulaPatch {
  const { cloud, nebula, view } = candidate;
  const job = { cloud, nebula, view, portrait, ...nebulaTileFrame(cloud, view) };
  if (portrait) nebulaPortraitPhotometry(nebula, view, portrait);
  const marchedField = baker?.nebulaTiles([job]);
    const { right, up, peakRadiance } = renderNebulaTile(
      atlas,
      tile,
      candidate.cloud,
      candidate.view,
      candidate.nebula,
      marchedField ? nebulaTileFromAtlas(marchedField, 0) : marchNebulaTile(job),
    );
    const { emission, reflection } = nebulaHues(candidate.nebula, candidate.view);
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
}

/** Apply an independently completed tile without replacing the sky. */
export function applySkyPortrait(background: Pick<SkyBackground, 'nebulae' | 'nebulaAtlas'>, update: SkyPortraitUpdate): boolean {
  const { patch, pixels } = update;
  const previous = background.nebulae[patch.tile];
  if (!previous || previous.seed !== patch.seed || pixels.length !== NEBULA_TILE * NEBULA_TILE * 4) return false;
  const width = NEBULA_ATLAS_COLS * NEBULA_TILE;
  for (let row = 0; row < NEBULA_TILE; row++) {
    const target = ((Math.floor(patch.tile / NEBULA_ATLAS_COLS) * NEBULA_TILE + row) * width + patch.tile % NEBULA_ATLAS_COLS * NEBULA_TILE) * 4;
    background.nebulaAtlas.set(pixels.subarray(row * NEBULA_TILE * 4, (row + 1) * NEBULA_TILE * 4), target);
  }
  background.nebulae[patch.tile] = patch;
  return true;
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

/** Clouds inside this radius shadow the sky individually. */
export const RIFT_NEAR_PC = LOCAL_CLOUD_RADIUS_PC;

/** In-plane visual opacity, shared by every dust consumer. */
export const DUST_KAPPA = DUST_OPACITY_PER_PC;

/**
 * The prominent nearby dark clouds, done exactly like the nebulae: each
 * ray-marches a tangent-plane sprite through its own density field —
 * accumulating optical depth instead of emission — so its shadow gets
 * per-object resolution instead of lat-long texels.
 */
function buildDarkClouds(
  viewpoint: GalacticPosition,
  dustKappa: number,
  baker: SkyMapBaker | null,
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

  const spriteSeeds = new Set<bigint>();
  const atlasWidth = DARK_ATLAS_COLS * DARK_TILE;
  const jobs: DarkTileJob[] = kept.map(({ cloud, distance }) => {
    const dx = cloud.positionPc.xPc - viewpoint.xPc;
    const dy = cloud.positionPc.yPc - viewpoint.yPc;
    const dz = cloud.positionPc.zPc - viewpoint.zPc;
    const view: [number, number, number] = [dx / distance, dy / distance, dz / distance];
    const axis: [number, number, number] = Math.abs(view[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const right = normalize(cross(view, axis));
    return { cloud, view, right, up: cross(view, right) };
  });
  const darkAtlas =
    baker?.darkTiles(jobs) ??
    new Float32Array(DARK_ATLAS_COLS * DARK_TILE * DARK_ATLAS_ROWS * DARK_TILE).fill(1);

  const darkClouds: DarkCloudPatch[] = kept.map(({ cloud, distance }, tile) => {
    spriteSeeds.add(cloud.seed);
    const { view, right, up } = jobs[tile];
    const reachPc = cloudReachPc(cloud);
    const dustFactor = cloudDustFactor(cloud) * dustKappa;
    const steps = 12;
    const ds = (2 * reachPc) / steps;
    const tileX = (tile % DARK_ATLAS_COLS) * DARK_TILE;
    const tileY = Math.floor(tile / DARK_ATLAS_COLS) * DARK_TILE;

    for (let j = baker ? DARK_TILE : 1; j < DARK_TILE - 1; j++) {
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
/** The clouds the rift map shadows the sky with: in reach, not
 *  carried as a sprite, and standing clear of the viewpoint with a
 *  footprint worth rasterizing. */
function riftClouds(viewpoint: GalacticPosition, excluded: Set<bigint>): MolecularCloud[] {
  const clouds: MolecularCloud[] = [];
  for (const cloud of cloudsNear(viewpoint, RIFT_NEAR_PC)) {
    if (excluded.has(cloud.seed)) continue;
    const dx = cloud.positionPc.xPc - viewpoint.xPc;
    const dy = cloud.positionPc.yPc - viewpoint.yPc;
    const dz = cloud.positionPc.zPc - viewpoint.zPc;
    const distance = Math.hypot(dx, dy, dz);
    const reachPc = cloudReachPc(cloud);
    // Inside or engulfing the sky: no meaningful footprint to rasterize.
    if (distance < reachPc || distance < 1) continue;
    if (Math.asin(Math.min(1, reachPc / distance)) > 1.0) continue;
    clouds.push(cloud);
  }
  return clouds;
}

function buildCloudTransmission(
  viewpoint: GalacticPosition,
  dustKappa: number,
  excluded: Set<bigint>,
  baker: SkyMapBaker | null,
): Float32Array {
  const clouds = riftClouds(viewpoint, excluded);
  if (baker) return baker.rift(viewpoint, clouds);
  const transmission = new Float32Array(RIFT_WIDTH * RIFT_HEIGHT).fill(1);
  const rowRad = Math.PI / RIFT_HEIGHT;
  const colRad = (2 * Math.PI) / RIFT_WIDTH;

  for (const cloud of clouds) {
    const dx = cloud.positionPc.xPc - viewpoint.xPc;
    const dy = cloud.positionPc.yPc - viewpoint.yPc;
    const dz = cloud.positionPc.zPc - viewpoint.zPc;
    const distance = Math.hypot(dx, dy, dz);
    const reachPc = cloudReachPc(cloud);
    const angRad = Math.asin(Math.min(1, reachPc / distance));

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
  baker: SkyMapBaker | null = null,
): {
  glowWidth: number;
  glowHeight: number;
  glowData: Float32Array;
  skyFloorRadiance: number;
  riftData: Float32Array;
} {
  const width = GLOW_WIDTH;
  const height = GLOW_HEIGHT;
  if (baker) {
    const data = baker.glow(viewpoint);
    let floor = Infinity;
    for (let index = 0; index < width * height; index++) {
      const at = index * 4;
      const y = data[at] * 0.2126 + data[at + 1] * 0.7152 + data[at + 2] * 0.0722;
      if (y < floor) floor = y;
    }
    return {
      glowWidth: width,
      glowHeight: height,
      glowData: data,
      skyFloorRadiance: floor,
      riftData: buildCloudTransmission(viewpoint, DUST_KAPPA, spriteSeeds, baker),
    };
  }
  const data = new Float32Array(width * height * 4);
  let floor = Infinity;
  for (let row = 0; row < height; row++) {
    if ((row & 15) === 0) onProgress?.(row / height);
    const latitude = ((row + 0.5) / height - 0.5) * Math.PI;
    for (let column = 0; column < width; column++) {
      const longitude = ((column + 0.5) / width) * 2 * Math.PI;
      const dirX = Math.cos(latitude) * Math.cos(longitude);
      const dirY = Math.cos(latitude) * Math.sin(longitude);
      const dirZ = Math.sin(latitude);

      const rgb = integrateGalaxyGlowRay(viewpoint, [dirX, dirY, dirZ], RIFT_NEAR_PC);
      const at = (row * width + column) * 4;
      data[at] = rgb[0]; data[at + 1] = rgb[1]; data[at + 2] = rgb[2]; data[at + 3] = 1;
      floor = Math.min(floor, rgbLuminance(rgb));
    }
  }

  // The pedestal is measured in the same optical-power luminance units
  // as nebula continuum. Instrument changes still require no re-bake.
  return {
    glowWidth: width,
    glowHeight: height,
    glowData: data,
    skyFloorRadiance: floor,
    riftData: buildCloudTransmission(viewpoint, DUST_KAPPA, spriteSeeds, null),
  };
}
