import { buildTemperatureLut, temperatureToLutCoord } from '../../core/color/blackbody';
import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { powerLaw } from '../../core/rng/distributions';
import { KROUPA_SEGMENTS } from '../star/imf';
import { evolve } from '../star/evolution';
import { dustDensity, stellarDensity, type GalacticPosition } from './density';
import { starPhotometry } from './photometry';
import { starsNear } from './sectors';

/**
 * The sky as seen from a point in the galaxy: every star bright enough
 * to resolve as a point (near stars individually from their sectors,
 * far bright stars statistically), plus a lat-long glow map of the
 * unresolved Milky Way band with dust-lane extinction.
 */
export interface SkyField {
  starCount: number;
  /** Unit view directions, xyz per star. */
  starDirs: Float32Array;
  /** Linear sRGB hue per star. */
  starColors: Float32Array;
  /** Relative irradiance per star (L☉/pc²). */
  starBrightness: Float32Array;
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

  return {
    starCount: brightness.length,
    starDirs: new Float32Array(dirs),
    starColors: new Float32Array(colors),
    starBrightness: new Float32Array(brightness),
    ...buildGlow(viewpoint),
  };
}

/** Line-of-sight integration of unresolved starlight through the dust disk. */
function buildGlow(viewpoint: GalacticPosition): {
  glowWidth: number;
  glowHeight: number;
  glowData: Float32Array;
} {
  const width = 96;
  const height = 48;
  const data = new Float32Array(width * height * 4);
  const stepPc = 400;
  const startPc = 2000;
  const endPc = 28000;
  // Mean luminosity density ≈ 0.7 L☉ per star, giants included.
  const meanLuminosity = 0.7;
  const dustKappa = 0.0011;

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
        opticalDepth += dustDensity(position) * dustKappa * stepPc;
        light +=
          stellarDensity(position) * meanLuminosity * stepPc * Math.exp(-opticalDepth);
      }

      // Dust reddens as well as dims; warm population base color.
      const reddening = Math.exp(-opticalDepth * 0.25);
      const index = (row * width + column) * 4;
      const scale = light * 6e-5;
      data[index] = scale * 1.0;
      data[index + 1] = scale * 0.93 * (0.75 + 0.25 * reddening);
      data[index + 2] = scale * 0.85 * (0.55 + 0.45 * reddening);
      data[index + 3] = 1;
    }
  }
  return { glowWidth: width, glowHeight: height, glowData: data };
}
