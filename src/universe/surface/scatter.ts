import { localSurfaceTemperatureK } from './params';
import { deriveSeed, mix64, seedFromHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { createSimplex3 } from '../../core/noise/simplex3';
import { faceUvToDir } from './cubeSphere';
import type { SurfaceField } from './field';

/** xyz anchor-relative km, size km, spin, kind (0 rock, 1 low growth),
 * rgb, then the terrain's outward normal. */
export const SCATTER_STRIDE = 12;

/** One physical tiling owns the population. Refinement must not stack
 * independently seeded populations on top of their ancestors. */
export function scatterLevel(radiusM: number): number {
  return Math.max(0, Math.ceil(Math.log2(Math.PI * radiusM / 2 / 240)));
}

const patchFields = new WeakMap<SurfaceField, ReturnType<typeof createSimplex3>>();

export function scatterForChunk(
  field: SurfaceField,
  face: number,
  level: number,
  x: number,
  y: number,
  centerKm: [number, number, number],
): Float32Array | null {
  const { params } = field;
  if (params.fullyMolten || level !== scatterLevel(params.radiusM)) return null;
  const tiles = 2 ** level;
  const tileSizeM = Math.PI / 2 / tiles * params.radiusM;
  const count = Math.min(160, Math.round(tileSizeM ** 2 / 650 * (0.5 + params.craterAmplitude)));
  const seed = deriveSeed(seedFromHex(params.seedHex), 'scatter');
  const rng = new Rng(mix64(seed ^ ((BigInt(face) << 60n) | (BigInt(level) << 54n) |
    (BigInt(x) << 27n) | BigInt(y))));
  let patches = patchFields.get(field);
  if (!patches) {
    patches = createSimplex3(deriveSeed(seed, 'patches'));
    patchFields.set(field, patches);
  }
  const data: number[] = [];
  const radiusKm = params.radiusM / 1000;
  for (let i = 0; i < count; i++) {
    const u = (x + rng.float()) / tiles;
    const v = (y + rng.float()) / tiles;
    const dir = faceUvToDir(face, u, v);
    const h = field.heightAt(dir);
    if (h <= field.waterLevelAt(dir) + 0.3) continue;

    // Metric derivatives include the body's shape, not just radial up:
    // especially on elongated asteroids, radial placement levitates rocks.
    const step = 0.5 / params.radiusM;
    const point = (du: number, dv: number): number[] => {
      const d = faceUvToDir(face, u + du, v + dv);
      const r = params.radiusM + field.heightAt(d);
      return [d.x * r, d.y * r, d.z * r];
    };
    const a0 = point(-step, 0), a1 = point(step, 0);
    const b0 = point(0, -step), b1 = point(0, step);
    const a = a1.map((n, k) => n - a0[k]);
    const b = b1.map((n, k) => n - b0[k]);
    let nx = a[1] * b[2] - a[2] * b[1];
    let ny = a[2] * b[0] - a[0] * b[2];
    let nz = a[0] * b[1] - a[1] * b[0];
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-12) continue;
    nx /= length; ny /= length; nz /= length;
    const slope = nx * dir.x + ny * dir.y + nz * dir.z;
    if (slope < 0.78) continue;

    const temperature = localSurfaceTemperatureK(params, dir, h);
    const moisture = field.climate?.precipAt(dir) ?? 0;
    const patchScale = params.radiusM / 110;
    const patch = patches(dir.x * patchScale, dir.y * patchScale, dir.z * patchScale);
    // A biosphere flag does not establish trees. Limit visible organisms
    // to sparse, low mats on mild, watered, gently sloping ground.
    const growth = params.biosphere && params.oceanCoverage > 0 && !params.globalIce &&
      temperature > 276 && temperature < 307 && moisture > 450 && slope > 0.94 &&
      patch > 0.22 && rng.bool(0.28);
    const kind = growth ? 1 : 0;
    // A steep size distribution: gravel and cobbles dominate, occasional
    // blocks provide scale. Body size caps rubble on very small asteroids.
    const maxSizeM = Math.min(5, params.radiusM * 0.015);
    const scaleM = growth ? rng.range(0.18, 0.65) :
      Math.min(maxSizeM, 0.12 * (1 - rng.float() * 0.998) ** -0.62 * (1 + 0.3 * params.craterAmplitude));
    const substrate = field.colorAt(dir, h, slope);
    const tone = rng.range(0.78, 1.08);
    const tint = growth ? params.palette.landA : substrate;
    const color = tint.map((c, k) => tone * (growth ? c * 0.6 : 0.75 * c + 0.25 * params.palette.rock[k]));
    const offsetKm = scaleM / 1000 * (growth ? -0.025 : 0.08);
    const rKm = radiusKm + h / 1000;
    data.push(
      dir.x * rKm + nx * offsetKm - centerKm[0],
      dir.y * rKm + ny * offsetKm - centerKm[1],
      dir.z * rKm + nz * offsetKm - centerKm[2],
      scaleM / 1000, rng.range(0, 2 * Math.PI), kind, ...color, nx, ny, nz,
    );
  }
  return data.length ? new Float32Array(data) : null;
}
