import { buildTemperatureLut, temperatureToLutCoord } from '../../core/color/blackbody';
import { createSimplex3 } from '../../core/noise/simplex3';
import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { powerLaw } from '../../core/rng/distributions';
import { KROUPA_SEGMENTS } from '../star/imf';
import { evolve } from '../star/evolution';
import { armBoost, dustDensity, stellarDensity, type GalacticPosition } from './density';
import { starPhotometry } from './photometry';
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

const NEBULA_PALETTE: Array<[number, number, number]> = [
  [1.0, 0.3, 0.35], // H-alpha
  [0.35, 0.85, 0.75], // O III
  [0.45, 0.6, 1.0], // reflection
];

/**
 * Coherent stellar groups in the far field: open clusters (coeval
 * members clumped within a few pc, so they read as Pleiades-like knots
 * in the sky) and OB associations (loose, very young, arm-favored,
 * bright and blue). The youngest carry emission nebulae.
 */
function buildGroups(
  viewpoint: GalacticPosition,
  localDensity: number,
  push: PushStar,
): NebulaPatch[] {
  const nebulae: NebulaPatch[] = [];
  const rng = new Rng(deriveSeed(0x534b59n, 'groups'));

  const addNebula = (
    dx: number,
    dy: number,
    dz: number,
    radiusPc: number,
    strength: number,
  ): void => {
    const distance = Math.hypot(dx, dy, dz);
    const mix = rng.float();
    const a = NEBULA_PALETTE[rng.int(NEBULA_PALETTE.length)];
    const b = NEBULA_PALETTE[rng.int(NEBULA_PALETTE.length)];
    nebulae.push({
      dir: [dx / distance, dy / distance, dz / distance],
      angularRadius: Math.min(0.35, radiusPc / distance),
      color: [
        a[0] * (1 - mix) + b[0] * mix,
        a[1] * (1 - mix) + b[1] * mix,
        a[2] * (1 - mix) + b[2] * mix,
      ],
      brightness: (strength * 2.5e4) / (distance * distance),
    });
  };

  const groupMembers = (
    dx: number,
    dy: number,
    dz: number,
    spreadPc: number,
    tries: number,
    minMass: number,
    ageGyr: number,
  ): void => {
    for (let i = 0; i < tries; i++) {
      const mx = dx + rng.normal(0, spreadPc);
      const my = dy + rng.normal(0, spreadPc);
      const mz = dz + rng.normal(0, spreadPc * 0.7);
      const physical = evolve(powerLaw(rng, 2.3, minMass, 60), ageGyr);
      const distanceSq = mx * mx + my * my + mz * mz;
      if (physical.luminosity / distanceSq < MIN_FAR_IRRADIANCE) continue;
      push(mx, my, mz, physical.luminosity, physical.tEff);
    }
  };

  // Open clusters: ~1.8e-7 per pc³ in the young disk → ~100 within 600 pc.
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
    const ageGyr = 10 ** rng.range(-2, 0.4);
    const richness = Math.floor(10 ** rng.range(1.7, 3));
    const coreRadiusPc = rng.range(1.5, 5);
    if (!keep) continue;
    groupMembers(
      dx,
      dy,
      dz,
      coreRadiusPc,
      Math.min(300, Math.ceil(richness * imfFractionAbove(1.0))),
      1.0,
      ageGyr,
    );
    if (ageGyr < 0.012 && rng.bool(0.7)) {
      addNebula(dx, dy, dz, rng.range(4, 14), 0.6);
    }
  }

  // OB associations: loose, arm-favored, a few Myr old.
  for (let i = 0; i < 12; i++) {
    const azimuth = rng.range(0, 2 * Math.PI);
    const planar = 120 + 550 * Math.sqrt(rng.float());
    const dx = planar * Math.cos(azimuth);
    const dy = planar * Math.sin(azimuth);
    const dz = rng.normal(0, 45) - viewpoint.zPc;
    const radius = Math.hypot(viewpoint.xPc + dx, viewpoint.yPc + dy);
    const armAzimuth = Math.atan2(viewpoint.yPc + dy, viewpoint.xPc + dx);
    if (rng.float() > armBoost(radius, armAzimuth) / 2.2) continue;
    const ageGyr = rng.range(0.002, 0.015);
    groupMembers(dx, dy, dz, rng.range(12, 30), rng.int(35) + 15, 4, ageGyr);
    addNebula(dx, dy, dz, rng.range(12, 35), 1.4);
  }

  return nebulae;
}

/**
 * Line-of-sight integration of unresolved starlight through the dust
 * disk. Dust is clumped with seeded noise so the band shows rifts and
 * lanes, and the accumulated light passes through a soft shoulder — the
 * galactic-center sightlines are orders of magnitude brighter than the
 * anticenter and would otherwise blow out into a shapeless blob.
 */
function buildGlow(viewpoint: GalacticPosition): {
  glowWidth: number;
  glowHeight: number;
  glowData: Float32Array;
} {
  const width = 192;
  const height = 96;
  const data = new Float32Array(width * height * 4);
  const stepPc = 300;
  const startPc = 1500;
  const endPc = 28000;
  // Mean luminosity density ≈ 0.7 L☉ per star, giants included.
  const meanLuminosity = 0.7;
  const dustKappa = 0.0011;
  const lanes = createSimplex3(deriveSeed(0x534b59n, 'dust-lanes'));

  for (let row = 0; row < height; row++) {
    const latitude = ((row + 0.5) / height - 0.5) * Math.PI;
    for (let column = 0; column < width; column++) {
      const longitude = ((column + 0.5) / width) * 2 * Math.PI;
      const dirX = Math.cos(latitude) * Math.cos(longitude);
      const dirY = Math.cos(latitude) * Math.sin(longitude);
      const dirZ = Math.sin(latitude);

      let light = 0;
      let opticalDepth = 0;
      for (let s = startPc; s < endPc; s += stepPc) {
        const position = {
          xPc: viewpoint.xPc + dirX * s,
          yPc: viewpoint.yPc + dirY * s,
          zPc: viewpoint.zPc + dirZ * s,
        };
        // Two-scale clumping: giant molecular complexes over broad lanes.
        const clump =
          0.55 +
          1.1 * (0.5 + 0.5 * lanes(position.xPc / 900, position.yPc / 900, position.zPc / 220)) +
          0.9 * Math.max(0, lanes(position.xPc / 260, position.yPc / 260, position.zPc / 90)) ** 2;
        opticalDepth += dustDensity(position) * clump * dustKappa * stepPc;
        light +=
          stellarDensity(position) * meanLuminosity * stepPc * Math.exp(-opticalDepth);
      }

      // Dust reddens as well as dims; warm population base color.
      const reddening = Math.exp(-opticalDepth * 0.25);
      const index = (row * width + column) * 4;
      const raw = light * 1.8e-5;
      // Reinhard shoulder: the band keeps its shape, the bulge keeps
      // its prominence without saturating to a blob.
      const scale = raw / (1 + 0.55 * raw);
      data[index] = scale * 1.0;
      data[index + 1] = scale * 0.93 * (0.75 + 0.25 * reddening);
      data[index + 2] = scale * 0.85 * (0.55 + 0.45 * reddening);
      data[index + 3] = 1;
    }
  }
  return { glowWidth: width, glowHeight: height, glowData: data };
}
