import type { Vec3 } from '../../core/math/vec3';
import { fbm, ridged } from '../../core/noise/fractal';
import { createSimplex3 } from '../../core/noise/simplex3';
import { createWorley3 } from '../../core/noise/worley3';
import { deriveSeed, seedFromHex } from '../../core/rng/hash';
import type { Characterization } from '../planet/types';
import { createCraterField } from './craters';
import { deriveSurfaceParams, type SurfaceParams } from './params';

type Rgb = [number, number, number];

export interface SurfaceField {
  params: SurfaceParams;
  /**
   * Terrain height above the datum sphere, meters. lodAngularRad is the
   * caller's sample spacing: detail bands below its Nyquist limit are
   * skipped (they could only alias). Omit for full detail.
   */
  heightAt(dir: Vec3, lodAngularRad?: number): number;
  /** Linear-sRGB ground color; slopeCos = cos(angle from vertical). */
  colorAt(dir: Vec3, heightM: number, slopeCos: number, lodAngularRad?: number): Rgb;
  /** Sea surface height, meters above datum (−Infinity when dry). */
  seaLevelM: number;
}

interface DetailBand {
  frequency: number;
  octaves: number;
  amplitudeM: number;
}

/**
 * The whole solid surface as one pure function of direction, identical
 * at every level of detail. Layer stack: continents → plate-boundary
 * mountain belts (tectonic worlds) → volcanic provinces → detail
 * roughness (muted by erosion) → craters (age- and atmosphere-gated).
 * Sea level is solved so the flooded fraction matches the climate's
 * ocean coverage.
 */
export function createSurfaceField(seedHex: string, physical: Characterization): SurfaceField {
  const params = deriveSurfaceParams(seedHex, physical);
  const seed = seedFromHex(seedHex);

  const continents = fbm(createSimplex3(deriveSeed(seed, 'continents')), { octaves: 4 });
  const mountains = ridged(createSimplex3(deriveSeed(seed, 'mountains')), { octaves: 5 });
  const detail = fbm(createSimplex3(deriveSeed(seed, 'detail')), { octaves: 5 });
  const bandNoise = createSimplex3(deriveSeed(seed, 'bands'));
  const provinces = fbm(createSimplex3(deriveSeed(seed, 'provinces')), { octaves: 3 });
  const boundaries = createWorley3(deriveSeed(seed, 'plates'));
  const craters = createCraterField(seedHex, params.radiusM, params.craterAmplitude);
  const moistureNoise = fbm(createSimplex3(deriveSeed(seed, 'moisture')), { octaves: 3 });
  const paletteNoise = fbm(createSimplex3(deriveSeed(seed, 'palette')), { octaves: 4 });

  const { reliefM, tectonics, erosion, volcanism } = params;
  const mountainStrength = tectonics === 'active' ? 1 : tectonics === 'stagnant' ? 0.25 : 0.1;

  // Roughness cascade below the continental scale, ~1/f amplitude falloff
  // down to ~100 m features. Erosion damps it; cratered dead worlds stay
  // rugged.
  const roughness = (1 - 0.72 * erosion) * (1 + 0.4 * params.craterAmplitude);
  const detailBands: DetailBand[] = [
    { frequency: 45, octaves: 3, amplitudeM: reliefM * 0.055 * roughness },
    { frequency: 280, octaves: 3, amplitudeM: reliefM * 0.016 * roughness },
    { frequency: 1700, octaves: 2, amplitudeM: reliefM * 0.005 * roughness },
    { frequency: 9000, octaves: 2, amplitudeM: reliefM * 0.0016 * roughness },
    { frequency: 45000, octaves: 2, amplitudeM: reliefM * 0.0005 * roughness },
  ];

  const heightAt = (dir: Vec3, lodAngularRad = 0): number => {
    let h = continents(dir.x * 1.3, dir.y * 1.3, dir.z * 1.3) * reliefM * 0.55;

    if (mountainStrength > 0.05) {
      // Fold belts where cell boundaries pinch (f2 ≈ f1).
      const cell = boundaries(dir.x * 1.6, dir.y * 1.6, dir.z * 1.6);
      const boundary = Math.max(0, 1 - (cell.f2 - cell.f1) / 0.22);
      if (boundary > 0) {
        const ridge = mountains(dir.x * 3.2, dir.y * 3.2, dir.z * 3.2);
        h += ridge * ridge * boundary * boundary * reliefM * 0.9 * mountainStrength;
      }
    }

    if (volcanism > 0.05) {
      const province = provinces(dir.x * 1.7, dir.y * 1.7, dir.z * 1.7);
      if (province > 0.25) {
        const dome = mountains(dir.x * 4.5, dir.y * 4.5, dir.z * 4.5);
        h += (province - 0.25) * dome * reliefM * 1.1 * volcanism;
      }
    }

    h += detail(dir.x * 7, dir.y * 7, dir.z * 7) * reliefM * 0.16 * (1 - 0.75 * erosion);

    for (let bandIndex = 0; bandIndex < detailBands.length; bandIndex++) {
      const band = detailBands[bandIndex];
      // Fade each band in across a LOD level: a hard Nyquist cut would
      // print visible patches wherever neighboring tiles differ in level.
      let fade = 1;
      if (lodAngularRad > 0) {
        const wavelengthRatio = 1 / band.frequency / (2 * lodAngularRad);
        if (wavelengthRatio <= 1) break;
        fade = Math.min(1, (wavelengthRatio - 1) / 1.5);
      }
      const offset = 17.31 * (bandIndex + 1);
      let amplitude = band.amplitudeM * fade;
      let frequency = band.frequency;
      let sum = 0;
      for (let o = 0; o < band.octaves; o++) {
        sum +=
          amplitude * bandNoise(dir.x * frequency + offset, dir.y * frequency, dir.z * frequency);
        amplitude *= 0.5;
        frequency *= 2.1;
      }
      h += sum;
    }

    h += craters(dir, lodAngularRad);
    return h;
  };

  const seaLevelM = solveSeaLevel(heightAt, params.oceanCoverage);
  const sand: Rgb = [
    Math.min(1, params.palette.landB[0] * 1.25 + 0.08),
    Math.min(1, params.palette.landB[1] * 1.2 + 0.06),
    Math.min(1, params.palette.landB[2] * 1.1 + 0.04),
  ];
  // Height-keyed color rules blend over windows wider than the detail
  // bands' LOD-dependent height swing, or coastlines flicker between levels.
  const shoreWindowM = Math.max(150, reliefM * 0.06);

  const colorAt = (dir: Vec3, heightM: number, slopeCos: number, lodAngularRad = 0): Rgb => {
    const { palette } = params;
    const latitude = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    const temperatureK =
      params.surfaceMeanK -
      params.poleDeltaK * Math.sin(latitude) ** 2 -
      (params.lapseKPerKm * Math.max(heightM, 0)) / 1000;

    // Smooth land↔seabed transition centered on sea level.
    const submersion =
      params.oceanCoverage > 0
        ? smooth01((seaLevelM - heightM) / shoreWindowM + 0.5)
        : 0;
    if (submersion >= 1) {
      const depth = Math.min(1, Math.max(0, seaLevelM - heightM) / 600);
      return mixRgb(sand, palette.seabed, depth ** 0.6);
    }

    const blend = 0.5 + 0.5 * paletteNoise(dir.x * 5.5, dir.y * 5.5, dir.z * 5.5);
    let ground = mixRgb(palette.landA, palette.landB, blend);

    if (params.biosphere) {
      const moisture =
        0.45 +
        0.4 * moistureNoise(dir.x * 2.2, dir.y * 2.2, dir.z * 2.2) +
        (params.oceanCoverage > 0 ? 0.1 : -0.2);
      // Continuous biome transitions: hard thresholds alias into blocky
      // borders at vertex resolution.
      const desertness =
        smooth01((temperatureK - 288) / 12) * smooth01((0.46 - moisture) / 0.12);
      ground = mixRgb(ground, sand, 0.75 * desertness);
      const bleakness = Math.max(
        smooth01((280 - temperatureK) / 10),
        smooth01((0.32 - moisture) / 0.08),
      );
      ground = mixRgb(ground, palette.rock, 0.5 * bleakness);
    }

    // Permanent ice fades in as the local mean drops below freezing.
    const iciness = params.globalIce ? 1 : smooth01((266 - temperatureK) / 8);
    if (iciness > 0) {
      const gray = 0.9 + 0.1 * paletteNoise(dir.x * 9, dir.y * 9, dir.z * 9);
      ground = mixRgb(
        ground,
        [palette.ice[0] * gray, palette.ice[1] * gray, palette.ice[2] * gray],
        iciness,
      );
    }

    // Bare rock breaks through on steep slopes; shores lighten to sand.
    if (slopeCos < 0.82) {
      ground = mixRgb(palette.rock, ground, Math.max(0, (slopeCos - 0.55) / 0.27));
    }
    if (params.oceanCoverage > 0) {
      ground = mixRgb(
        sand,
        ground,
        smooth01((heightM - seaLevelM) / shoreWindowM),
      );
    }
    if (submersion > 0) {
      const depth = Math.min(1, Math.max(0, seaLevelM - heightM) / 600);
      ground = mixRgb(ground, mixRgb(sand, palette.seabed, depth ** 0.6), submersion);
    }
    return ground;
  };

  return { params, heightAt, colorAt, seaLevelM };
}

/** Height whose flooded fraction matches coverage, via a golden-spiral sample. */
function solveSeaLevel(
  heightAt: (dir: Vec3, lodAngularRad?: number) => number,
  coverage: number,
): number {
  if (coverage <= 0) return -Infinity;
  const samples: number[] = [];
  const n = 1400;
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * 2.399963229728653;
    // Coarse LOD: sea level is set by continental structure, not meter bumps.
    samples.push(heightAt({ x: r * Math.cos(phi), y, z: r * Math.sin(phi) }, 0.002));
  }
  samples.sort((a, b) => a - b);
  const index = Math.min(n - 1, Math.floor(coverage * n));
  return samples[index];
}

/** Smoothstep of t clamped to [0, 1]. */
function smooth01(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * clamped,
    a[1] + (b[1] - a[1]) * clamped,
    a[2] + (b[2] - a[2]) * clamped,
  ];
}
