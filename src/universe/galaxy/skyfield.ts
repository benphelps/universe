import {
  blackbodyLinearRgb,
  buildTemperatureLut,
  temperatureToLutCoord,
} from '../../core/color/blackbody';
import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { powerLaw } from '../../core/rng/distributions';
import { KROUPA_SEGMENTS } from '../star/imf';
import { evolve } from '../star/evolution';
import { cloudFieldAt, cloudsNear } from './clouds';
import { dustDensity, stellarDensity, type GalacticPosition } from './density';
import { starPhotometry } from './photometry';
import { drawPopulation } from './population';
import { starsNear } from './sectors';

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
  /** Linear sRGB emission hue. */
  color: [number, number, number];
  /** Peak brightness factor for the sky shader. */
  brightness: number;
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
  /** Emission/reflection nebulae around the youngest groups. */
  nebulae: NebulaPatch[];
  glowWidth: number;
  glowHeight: number;
  /** RGBA float lat-long map of unresolved background light. */
  glowData: Float32Array;
}

interface Shell {
  innerPc: number;
  outerPc: number;
  minMass: number;
  maxStars: number;
}

/** Resolved-star shells: farther shells keep only intrinsically bright stars.
 *  The 1.0 M☉ floor matters: evolved giants of modest mass carry much of
 *  the real naked-eye sky. */
const SHELLS: Shell[] = [
  { innerPc: 30, outerPc: 150, minMass: 1.0, maxStars: 60000 },
  { innerPc: 150, outerPc: 600, minMass: 2.2, maxStars: 50000 },
  { innerPc: 600, outerPc: 2500, minMass: 7, maxStars: 20000 },
];

/** Keep sampled far stars down to apparent magnitude ≈ 9. */
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

export function buildSkyField(viewpoint: GalacticPosition): SkyField {
  const lut = buildTemperatureLut(96);
  const dirs: number[] = [];
  const colors: number[] = [];
  const brightness: number[] = [];

  const push = (dx: number, dy: number, dz: number, luminosity: number, tEff: number): void => {
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq < 1e-6) return;
    const distance = Math.sqrt(distanceSq);
    const lutIndex = Math.min(95, Math.floor(temperatureToLutCoord(tEff) * 95)) * 4;
    dirs.push(dx / distance, dy / distance, dz / distance);
    colors.push(lut[lutIndex], lut[lutIndex + 1], lut[lutIndex + 2]);
    brightness.push(luminosity / distanceSq);
  };

  // Near field: the actual sector population, every star.
  for (const slot of starsNear(viewpoint, NEAR_RADIUS_PC)) {
    const physical = starPhotometry(slot.seed);
    if (physical.luminosity <= 0) continue;
    push(
      slot.positionPc.xPc - viewpoint.xPc,
      slot.positionPc.yPc - viewpoint.yPc,
      slot.positionPc.zPc - viewpoint.zPc,
      physical.luminosity,
      physical.tEff,
    );
  }

  const nearStarCount = brightness.length;

  // Far shells: statistical bright-star population, density-weighted.
  const localDensity = stellarDensity(viewpoint);
  for (let shellIndex = 0; shellIndex < SHELLS.length; shellIndex++) {
    const shell = SHELLS[shellIndex];
    const rng = new Rng(deriveSeed(0x534b59n, 'shell', shellIndex));
    const volume = (4 / 3) * Math.PI * (shell.outerPc ** 3 - shell.innerPc ** 3);
    const expected = Math.min(
      shell.maxStars,
      volume * localDensity * imfFractionAbove(shell.minMass),
    );
    for (let i = 0; i < expected; i++) {
      // Uniform in the shell, thinned by the density ratio (z falloff).
      const u = rng.float();
      const distance = Math.cbrt(
        shell.innerPc ** 3 + u * (shell.outerPc ** 3 - shell.innerPc ** 3),
      );
      const z = rng.range(-1, 1);
      const azimuth = rng.range(0, 2 * Math.PI);
      const planar = Math.sqrt(Math.max(0, 1 - z * z));
      const dx = distance * planar * Math.cos(azimuth);
      const dy = distance * planar * Math.sin(azimuth);
      const dz = distance * z;
      const there = {
        xPc: viewpoint.xPc + dx,
        yPc: viewpoint.yPc + dy,
        zPc: viewpoint.zPc + dz,
      };
      if (rng.float() > Math.min(1, stellarDensity(there) / localDensity)) continue;

      const mass = powerLaw(rng, 2.3, shell.minMass, 120);
      const physical = evolve(mass, rng.range(0.1, 10));
      if (physical.luminosity / (distance * distance) < MIN_FAR_IRRADIANCE) continue;
      push(dx, dy, dz, physical.luminosity, physical.tEff);
    }
  }

  const nebulae = buildGroups(viewpoint, localDensity, push);

  return {
    starCount: brightness.length,
    nearStarCount,
    starDirs: new Float32Array(dirs),
    starColors: new Float32Array(colors),
    starBrightness: new Float32Array(brightness),
    nebulae,
    ...buildGlow(viewpoint),
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
): NebulaPatch[] {
  const nebulae: NebulaPatch[] = [];

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
    nebulae.push({
      dir: [dx / distance, dy / distance, dz / distance],
      angularRadius: Math.min(0.35, cloud.radiusPc / distance),
      color: nebulaColor(light.maxTeff),
      brightness:
        ((0.3 + 1.1 * ionization) * 95 * Math.sqrt(light.totalLuminosity)) /
        (distance * distance),
    });
  }

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

  return nebulae;
}

/**
 * Mean stellar luminosity of the local population, derived from the IMF
 * and the population mix rather than assumed. The bright tail — rare
 * massive stars and giants — carries most of the light, so this is a
 * stratified quadrature over a log-mass grid (IMF-weighted) crossed
 * with ages drawn from the population mix, not Monte Carlo.
 */
function meanPopulationLuminosity(viewpoint: GalacticPosition): number {
  const rng = new Rng(deriveSeed(0x534b59n, 'mean-luminosity'));
  const ages: number[] = [];
  for (let i = 0; i < 12; i++) ages.push(drawPopulation(rng, viewpoint).ageGyr);

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
function buildGlow(viewpoint: GalacticPosition): {
  glowWidth: number;
  glowHeight: number;
  glowData: Float32Array;
} {
  const width = 192;
  const height = 96;
  const data = new Float32Array(width * height * 4);
  const startPc = 80;
  const endPc = 25000;
  const meanLuminosity = meanPopulationLuminosity(viewpoint);
  const dustKappa = 0.045;

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
        // Diffuse dust plus the cloud population's clumped component.
        const clump = 0.45 + 1.6 * cloudFieldAt(position);
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
  return { glowWidth: width, glowHeight: height, glowData: data };
}
