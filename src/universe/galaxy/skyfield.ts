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
import { CATALOG_ROWS, luminosityCeiling, sweepRowStars } from './catalog';
import {
  cloudFieldAt,
  cloudLocalDensity,
  cloudReachPc,
  cloudsNear,
  type MolecularCloud,
} from './clouds';
import { dustDensity, stellarDensity, type GalacticPosition } from './density';
import { sceneFromGalaxy } from './orientation';
import { starPhotometry } from './photometry';
import { populationFromUnit } from './population';

/**
 * The sky as seen from a point in the galaxy: every star bright enough
 * to resolve as a point (near stars individually from their sectors,
 * far bright stars statistically), plus a lat-long glow map of the
 * unresolved Milky Way band with dust-lane extinction.
 */
export interface NebulaPatch {
  /** Unit view direction (galactic frame, like starDirs). */
  dir: [number, number, number];
  angularRadius: number;
  /** Linear sRGB emission hue (tile pixels carry the per-pixel mix). */
  color: [number, number, number];
  /** Peak brightness factor for the sky shader. */
  brightness: number;
  /** Tangent-plane basis (galactic frame) matching the sprite tile. */
  right: [number, number, number];
  up: [number, number, number];
  /** Tile index into the nebula sprite atlas. */
  tile: number;
}

/** Nebula sprite atlas layout: NEBULA_TILE² RGBA tiles in a grid. */
export const NEBULA_TILE = 48;
export const NEBULA_ATLAS_COLS = 8;
export const NEBULA_ATLAS_ROWS = 6;

/** Cloud-shadow transmission map resolution (4× the glow map). */
export const RIFT_WIDTH = 768;
export const RIFT_HEIGHT = 384;

/** Dark-cloud sprite atlas: transmission tiles, one per prominent cloud. */
export const DARK_TILE = 64;
export const DARK_ATLAS_COLS = 8;
export const DARK_ATLAS_ROWS = 8;

export interface DarkCloudPatch {
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
  /** RGBA float lat-long map of unresolved background light. */
  glowData: Float32Array;
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
}

/** Keep far stars down to apparent magnitude ≈ 9. */
const MIN_FAR_IRRADIANCE = 1.5e-4;

const NEAR_RADIUS_PC = 30;

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

export function buildSkyField(viewpoint: GalacticPosition, seed = 0n): SkyField {
  const lut = buildTemperatureLut(96);
  const makeAccum = (): StarAccum => ({
    dirs: [],
    colors: [],
    brightness: [],
    distances: [],
    teffs: [],
    seeds: [],
  });
  const near = makeAccum();
  const far = makeAccum();

  const pushTo = (
    acc: StarAccum,
    dx: number,
    dy: number,
    dz: number,
    luminosity: number,
    tEff: number,
    starSeed: bigint,
  ): void => {
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
  };
  const push: PushStar = (dx, dy, dz, luminosity, tEff) =>
    pushTo(far, dx, dy, dz, luminosity, tEff, 0n);

  // The resolved sky is the catalog itself: within the near radius every
  // star, beyond it every star of each survey row bright enough to see —
  // a mass ceiling culls hopeless candidates before their seed is built.
  const nearSq = NEAR_RADIUS_PC * NEAR_RADIUS_PC;
  for (const row of CATALOG_ROWS) {
    const skySq = row.skyRadiusPc * row.skyRadiusPc;
    sweepRowStars(
      row,
      viewpoint,
      Math.max(NEAR_RADIUS_PC, row.skyRadiusPc),
      (x, y, z, massBits, ageBits, entropy) => {
        const dx = x - viewpoint.xPc;
        const dy = y - viewpoint.yPc;
        const dz = z - viewpoint.zPc;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1e-6) return;
        if (d2 <= nearSq) {
          const starSeed = seedForIdentity(massBits, ageBits, entropy);
          const physical = starPhotometry(starSeed);
          if (physical.luminosity <= 0) return;
          pushTo(near, dx, dy, dz, physical.luminosity, physical.tEff, starSeed);
          return;
        }
        if (d2 > skySq) return;
        const mass = initialMassFromUnit(unitFromBits(massBits, MASS_BIT_SPAN));
        if (luminosityCeiling(mass) / d2 < MIN_FAR_IRRADIANCE) return;
        const starSeed = seedForIdentity(massBits, ageBits, entropy);
        const physical = starPhotometry(starSeed);
        if (physical.luminosity / d2 < MIN_FAR_IRRADIANCE) return;
        pushTo(far, dx, dy, dz, physical.luminosity, physical.tEff, starSeed);
      },
    );
  }
  const nearStarCount = near.brightness.length;

  const localDensity = stellarDensity(viewpoint);
  const { nebulae, nebulaAtlas } = buildGroups(viewpoint, localDensity, push);
  const { darkClouds, darkAtlas, spriteSeeds } = buildDarkClouds(viewpoint, DUST_KAPPA);

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

  return {
    starCount,
    nearStarCount,
    starDirs: join(near.dirs, far.dirs),
    starColors: join(near.colors, far.colors),
    starBrightness: join(near.brightness, far.brightness),
    starDistances: join(near.distances, far.distances),
    starTeffs: join(near.teffs, far.teffs),
    starSeeds,
    nebulae,
    nebulaAtlas,
    darkClouds,
    darkAtlas,
    sceneFromGalaxy: sceneFromGalaxy(seed),
    ...buildGlow(viewpoint, spriteSeeds),
  };
}

type PushStar = (dx: number, dy: number, dz: number, luminosity: number, tEff: number) => void;

interface GroupLight {
  maxTeff: number;
  totalLuminosity: number;
}

/** Coeval members around a center; returns what formed, pushing the visible. */
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
): GroupLight {
  const light: GroupLight = { maxTeff: 0, totalLuminosity: 0 };
  for (let i = 0; i < tries; i++) {
    const mx = dx + rng.normal(0, spreadPc);
    const my = dy + rng.normal(0, spreadPc);
    const mz = dz + rng.normal(0, spreadPc * 0.7);
    const physical = evolve(powerLaw(rng, 2.3, minMass, 60), ageGyr);
    light.totalLuminosity += physical.luminosity;
    if (physical.tEff > light.maxTeff) light.maxTeff = physical.tEff;
    const distanceSq = mx * mx + my * my + mz * mz;
    if (physical.luminosity / distanceSq < MIN_FAR_IRRADIANCE) continue;
    push(mx, my, mz, physical.luminosity, physical.tEff);
  }
  return light;
}

/**
 * Nebular hue from the hottest embedded star: hot enough to ionize the
 * gas and the cloud emits (Hα red, hardening toward O III teal under the
 * hottest stars); otherwise the cloud merely scatters the starlight as
 * a blue-leaning reflection nebula.
 */
function nebulaColor(maxTeff: number): [number, number, number] {
  const ionization = Math.max(0, Math.min(1, (maxTeff - 17000) / 13000));
  const hardness = Math.max(0, Math.min(1, (maxTeff - 28000) / 17000));
  const emission: [number, number, number] = [
    1.0 * (1 - hardness * 0.6) + 0.35 * hardness * 0.6,
    0.3 * (1 - hardness * 0.6) + 0.9 * hardness * 0.6,
    0.34 * (1 - hardness * 0.6) + 0.8 * hardness * 0.6,
  ];
  const [sr, sg, sb] = blackbodyLinearRgb(Math.max(maxTeff, 3000));
  const reflection: [number, number, number] = [
    sr * 0.55 + 0.12,
    sg * 0.65 + 0.18,
    sb * 0.75 + 0.35,
  ];
  return [
    reflection[0] + (emission[0] - reflection[0]) * ionization,
    reflection[1] + (emission[1] - reflection[1]) * ionization,
    reflection[2] + (emission[2] - reflection[2]) * ionization,
  ];
}

/**
 * Ray-march one lit cloud into an atlas tile: the cloud's own turbulent
 * density field, illuminated by the embedded group at its core with
 * self-extinction along the view path. Filaments, the bright core, dark
 * foreground lanes, and soft edges all come from the field itself. The
 * pixel hue slides from the ionized emission color near the stars to
 * scattered reflection light in the outskirts.
 */
function renderNebulaTile(
  atlas: Float32Array,
  tile: number,
  cloud: MolecularCloud,
  view: [number, number, number],
  maxTeff: number,
): { right: [number, number, number]; up: [number, number, number]; peak: number } {
  const axis: [number, number, number] =
    Math.abs(view[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const right = normalize(cross(view, axis));
  const up = cross(view, right);

  const ionization = Math.max(0, Math.min(1, (maxTeff - 17000) / 13000));
  const emission = nebulaColor(Math.max(maxTeff, 17000));
  const scattered = nebulaColor(Math.min(maxTeff, 12000));

  const extentPc = cloud.radiusPc * 1.6;
  const steps = 16;
  const dt = (2 * extentPc) / steps;
  const extinction = 0.9 / (cloud.amplitude * cloud.radiusPc);
  const atlasWidth = NEBULA_ATLAS_COLS * NEBULA_TILE;
  const tileX = (tile % NEBULA_ATLAS_COLS) * NEBULA_TILE;
  const tileY = Math.floor(tile / NEBULA_ATLAS_COLS) * NEBULA_TILE;

  let peak = 1e-6;
  const rgb = new Float32Array(NEBULA_TILE * NEBULA_TILE * 3);
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
      let r = 0;
      let g = 0;
      let b = 0;
      for (let s = 0; s < steps; s++) {
        const t = -extentPc + (s + 0.5) * dt;
        const px = ox + view[0] * t;
        const py = oy + view[1] * t;
        const pz = oz + view[2] * t;
        const density = cloudLocalDensity(cloud, px, py, pz);
        if (density <= 0) continue;
        const coreSq = (px * px + py * py + pz * pz) / (0.35 * cloud.radiusPc) ** 2;
        const illumination = 1 / (1 + coreSq);
        const glow = density * illumination * Math.exp(-tau) * dt;
        const ionLocal = ionization * Math.min(1, illumination * 2.2);
        r += glow * (scattered[0] + (emission[0] - scattered[0]) * ionLocal);
        g += glow * (scattered[1] + (emission[1] - scattered[1]) * ionLocal);
        b += glow * (scattered[2] + (emission[2] - scattered[2]) * ionLocal);
        tau += density * extinction * dt;
      }
      const out = (j * NEBULA_TILE + i) * 3;
      rgb[out] = r;
      rgb[out + 1] = g;
      rgb[out + 2] = b;
      peak = Math.max(peak, Math.max(r, g, b));
    }
  }

  // Peak-normalize the tile; the photometric scale rides in brightness.
  for (let j = 0; j < NEBULA_TILE; j++) {
    for (let i = 0; i < NEBULA_TILE; i++) {
      const src = (j * NEBULA_TILE + i) * 3;
      const dst = ((tileY + j) * atlasWidth + tileX + i) * 4;
      atlas[dst] = rgb[src] / peak;
      atlas[dst + 1] = rgb[src + 1] / peak;
      atlas[dst + 2] = rgb[src + 2] / peak;
      atlas[dst + 3] = 1;
    }
  }
  return { right, up, peak };
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
  view: [number, number, number];
  distancePc: number;
  maxTeff: number;
  brightness: number;
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
    const rng = new Rng(deriveSeed(cloud.seed, 'formation'));
    // Bigger clouds are likelier to be forming stars right now.
    if (rng.float() > 0.1 + cloud.radiusPc / 170) continue;
    const dx = cloud.positionPc.xPc - viewpoint.xPc;
    const dy = cloud.positionPc.yPc - viewpoint.yPc;
    const dz = cloud.positionPc.zPc - viewpoint.zPc;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 50) continue;

    const ageGyr = rng.range(0.0015, 0.012);
    const tries = Math.min(240, Math.round(cloud.radiusPc ** 1.5 * rng.range(0.4, 1.1)));
    const light = groupMembers(rng, push, dx, dy, dz, cloud.radiusPc * 0.35, tries, 1.0, ageGyr);
    if (light.maxTeff < 6500) continue;

    const ionization = Math.max(0, Math.min(1, (light.maxTeff - 17000) / 13000));
    candidates.push({
      cloud,
      view: [dx / distance, dy / distance, dz / distance],
      distancePc: distance,
      maxTeff: light.maxTeff,
      brightness:
        ((0.3 + 1.1 * ionization) * 95 * Math.sqrt(light.totalLuminosity)) /
        (distance * distance),
    });
  }

  // The atlas holds the brightest; ray-march only those.
  candidates.sort((a, b) => b.brightness - a.brightness);
  const kept = candidates.slice(0, NEBULA_ATLAS_COLS * NEBULA_ATLAS_ROWS);
  const nebulaAtlas = new Float32Array(
    NEBULA_ATLAS_COLS * NEBULA_TILE * NEBULA_ATLAS_ROWS * NEBULA_TILE * 4,
  );
  const nebulae: NebulaPatch[] = kept.map((candidate, tile) => {
    const { right, up } = renderNebulaTile(
      nebulaAtlas,
      tile,
      candidate.cloud,
      candidate.view,
      candidate.maxTeff,
    );
    return {
      dir: candidate.view,
      angularRadius: Math.min(0.35, candidate.cloud.radiusPc / candidate.distancePc),
      color: nebulaColor(candidate.maxTeff),
      brightness: candidate.brightness,
      right,
      up,
      tile,
    };
  });

  // Dispersed open clusters: ~1.8e-7 per pc³ in the young disk.
  const rng = new Rng(deriveSeed(0x534b59n, 'groups'));
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

/**
 * Mean stellar luminosity of the local population, derived from the IMF
 * and the population mix rather than assumed. The bright tail — rare
 * massive stars and giants — carries most of the light, so this is a
 * stratified quadrature over a log-mass grid (IMF-weighted) crossed
 * with ages drawn from the population mix, not Monte Carlo.
 */
export function meanPopulationLuminosity(viewpoint: GalacticPosition): number {
  const rng = new Rng(deriveSeed(0x534b59n, 'mean-luminosity'));
  const ages: number[] = [];
  for (let i = 0; i < 12; i++) ages.push(populationFromUnit(rng.float(), viewpoint).ageGyr);

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
  return lumSum / Math.max(weightSum, 1e-9);
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
    const dustFactor = dustDensity(cloud.positionPc) * 1.6 * dustKappa;
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

    return { dir: view, halfExtent: reachPc / distance, right, up, tile };
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

    const dustFactor = dustDensity(cloud.positionPc) * 1.6 * dustKappa;
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
): {
  glowWidth: number;
  glowHeight: number;
  glowData: Float32Array;
  riftData: Float32Array;
} {
  const width = 192;
  const height = 96;
  const data = new Float32Array(width * height * 4);
  const startPc = 80;
  const endPc = 25000;
  const meanLuminosity = meanPopulationLuminosity(viewpoint);
  const dustKappa = DUST_KAPPA;

  for (let row = 0; row < height; row++) {
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
        // smooth at its texel scale. Distant clumping is sub-texel and
        // folds back in statistically.
        const clump = s > RIFT_NEAR_PC ? 0.45 + 1.6 * cloudFieldAt(position) : 0.45;
        opticalDepth += dustDensity(position) * clump * dustKappa * stepPc;
        light +=
          stellarDensity(position) * meanLuminosity * stepPc * Math.exp(-opticalDepth);
      }

      // Dust reddens as well as dims; warm population base color.
      const reddening = Math.exp(-opticalDepth * 0.25);
      const index = (row * width + column) * 4;
      const raw = light * 2.3e-4;
      // Gentle knee only: structure survives, nothing hard-saturates.
      const scale = raw / (1 + 0.2 * raw);
      data[index] = scale * 1.0;
      data[index + 1] = scale * 0.93 * (0.75 + 0.25 * reddening);
      data[index + 2] = scale * 0.85 * (0.55 + 0.45 * reddening);
      data[index + 3] = 1;
    }
  }
  return {
    glowWidth: width,
    glowHeight: height,
    glowData: data,
    riftData: buildCloudTransmission(viewpoint, dustKappa, spriteSeeds),
  };
}
