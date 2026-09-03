import type { Vec3 } from '../../core/math/vec3';
import { fbm } from '../../core/noise/fractal';
import { createSimplex3 } from '../../core/noise/simplex3';
import { deriveSeed, seedFromHex } from '../../core/rng/hash';
import type { Asteroid } from '../smallbody/types';
import { createCraterField } from './craters';
import type { SurfaceField } from './field';

type Rgb = [number, number, number];

const TAXONOMY_COLOR: Record<Asteroid['taxonomy'], Rgb> = {
  S: [0.4, 0.34, 0.27],
  C: [0.16, 0.152, 0.145],
  M: [0.4, 0.4, 0.43],
  D: [0.2, 0.16, 0.13],
};

/**
 * An asteroid as a pure surface field over the datum sphere: an
 * ellipsoid (optionally a two-lobed contact binary) with low-order
 * lumps, saturated cratering, and regolith roughness. Runs through the
 * same cube-sphere streamer as planets — height amplitudes are simply a
 * large fraction of the radius.
 */
export function createAsteroidField(asteroid: Asteroid): SurfaceField {
  const { shape } = asteroid;
  const radiusM = asteroid.diameterKm * 500;
  const seed = seedFromHex(shape.noiseSeedHex);
  const lobes = fbm(createSimplex3(deriveSeed(seed, 'lobes')), { octaves: 3 });
  const regolith = createSimplex3(deriveSeed(seed, 'regolith'));
  const paletteNoise = fbm(createSimplex3(deriveSeed(seed, 'palette')), { octaves: 3 });
  const craters = createCraterField(shape.noiseSeedHex, radiusM, 1);

  // Semi-axes: elongation stretches x, flattening squashes the pole.
  const axisX = 1 / Math.max(0.45, shape.elongation);
  const axisY = Math.max(0.45, shape.flattening);
  const lumpiness = Math.min(0.5, 1.1 * (2 - shape.elongation - shape.flattening)) + 0.06;

  const shapeRadius = (dir: Vec3): number => {
    let r =
      1 /
      Math.sqrt(
        (dir.x / axisX) ** 2 + (dir.y / axisY) ** 2 + dir.z ** 2,
      );
    if (shape.contactBinary) {
      // Second lobe: a smaller sphere offset along +x, blended by max.
      const offset = 0.62 * axisX;
      const lobeRadius = 0.52 * axisX;
      const under = lobeRadius ** 2 - offset ** 2 * (1 - dir.x ** 2);
      if (dir.x > 0 && under > 0) {
        r = Math.max(r, offset * dir.x + Math.sqrt(under));
      }
    }
    return r * (1 + lumpiness * 0.35 * lobes(dir.x * 2.1, dir.y * 2.1, dir.z * 2.1));
  };

  const heightAt = (dir: Vec3, lodAngularRad = 0): number => {
    let h = (shapeRadius(dir) - 1) * radiusM;

    // Regolith roughness bands with the usual Nyquist fade, down to
    // boulder scale so close approach never goes featureless.
    for (const [frequency, amplitude] of [
      [40, radiusM * 0.014],
      [220, radiusM * 0.0045],
      [1200, radiusM * 0.0015],
      [7000, radiusM * 0.0005],
      [38000, radiusM * 0.00016],
    ] as const) {
      let fade = 1;
      if (lodAngularRad > 0) {
        const wavelengthRatio = 1 / frequency / (2 * lodAngularRad);
        if (wavelengthRatio <= 1) break;
        fade = Math.min(1, (wavelengthRatio - 1) / 4);
      }
      h += amplitude * fade * regolith(dir.x * frequency, dir.y * frequency + 3.7, dir.z * frequency);
    }

    h += craters(dir, lodAngularRad);
    return h;
  };

  const base = TAXONOMY_COLOR[asteroid.taxonomy];
  const colorAt = (dir: Vec3, _heightM: number, slopeCos: number): Rgb => {
    const tone = 0.82 + 0.36 * (0.5 + 0.5 * paletteNoise(dir.x * 6, dir.y * 6, dir.z * 6));
    // Steep faces shed regolith and read slightly darker and bluer.
    const slope = Math.max(0, Math.min(1, (0.85 - slopeCos) / 0.5));
    return [
      Math.min(1, base[0] * tone * (1 - 0.25 * slope)),
      Math.min(1, base[1] * tone * (1 - 0.22 * slope)),
      Math.min(1, base[2] * tone * (1 - 0.16 * slope)),
    ];
  };

  return {
    params: {
      seedHex: shape.noiseSeedHex,
      radiusM,
      reliefM: radiusM * (lumpiness * 0.35 + 0.1),
      oceanCoverage: 0,
      magmaCoverage: 0,
      fullyMolten: false,
      tectonics: 'dead',
      craterAmplitude: 1,
      rotationPeriodHours: asteroid.spinPeriodHours,
      erosion: 0.05,
      volcanism: 0,
      surfaceMeanK: 170,
      poleDeltaK: 0,
      lapseKPerKm: 0,
      biosphere: false,
      globalIce: false,
      palette: {
        landA: base,
        landB: base,
        rock: base,
        ice: [0.8, 0.82, 0.85],
        seabed: base,
      },
    },
    heightAt,
    colorAt,
    seaLevelM: -Infinity,
    waterLevelAt: () => -Infinity,
    drainage: null,
    climate: null,
  };
}
