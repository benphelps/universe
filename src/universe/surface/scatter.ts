import { deriveSeed, mix64, seedFromHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { faceUvToDir } from './cubeSphere';
import type { SurfaceField } from './field';

/** Floats per instance: position xyz (anchor-relative km), scale (km),
 *  spin, shrub flag, rgb. */
export const SCATTER_STRIDE = 9;

/** Tiles outside this physical size band carry no scatter. Levels nest,
 *  so the near field accumulates every band member's population. */
const MIN_TILE_M = 40;
const MAX_TILE_M = 2600;

/**
 * Deterministic surface scatter for one terrain tile: boulders shed from
 * the regolith everywhere, ground cover on temperate biosphere worlds.
 * Placement re-samples the height field so instances sit on the ground,
 * skip water, and know their local climate. Pure and chunk-seeded, so
 * any tile regenerates identically.
 */
export function scatterForChunk(
  field: SurfaceField,
  face: number,
  level: number,
  x: number,
  y: number,
  centerKm: [number, number, number],
): Float32Array | null {
  const { params } = field;
  const tiles = 2 ** level;
  const tileSizeM = (Math.PI / 2 / tiles) * params.radiusM;
  if (tileSizeM < MIN_TILE_M || tileSizeM > MAX_TILE_M) return null;

  // Instance budget by physical area; airless cratered surfaces are
  // boulder-strewn, wet eroded worlds sparse.
  const density = 22 * (0.6 + 6 * params.craterAmplitude + (params.biosphere ? 0.5 : 0));
  const count = Math.min(360, Math.max(3, Math.round((tileSizeM / 600) ** 2 * density)));
  const rng = new Rng(
    mix64(
      deriveSeed(seedFromHex(params.seedHex), 'scatter') ^
        ((BigInt(face) << 60n) |
          (BigInt(level & 0x1f) << 54n) |
          (BigInt(x & 0x7ffffff) << 27n) |
          BigInt(y & 0x7ffffff)),
    ),
  );

  const radiusKm = params.radiusM / 1000;
  const data: number[] = [];
  for (let i = 0; i < count; i++) {
    const dir = faceUvToDir(face, (x + rng.float()) / tiles, (y + rng.float()) / tiles);
    const h = field.heightAt(dir);
    if (h < field.seaLevelM + 2) continue;

    const latitude = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    const temperatureK =
      params.surfaceMeanK -
      params.poleDeltaK * Math.sin(latitude) ** 2 -
      (params.lapseKPerKm * Math.max(h, 0)) / 1000;
    const shrub =
      params.biosphere && temperatureK > 258 && temperatureK < 318 && rng.bool(0.72);

    // Airless rubble carries a large-block tail (Bennu- and
    // Itokawa-style multi-meter boulders); eroded worlds break rocks down.
    let scaleM = shrub ? rng.range(0.8, 1.8) : rng.range(0.6, 2.8) * (1 + 3 * params.craterAmplitude);
    if (!shrub && rng.bool(0.05)) scaleM *= rng.range(2, 3.5);
    let r: number;
    let g: number;
    let b: number;
    if (shrub) {
      const tone = rng.range(0.4, 0.65);
      r = params.palette.landA[0] * tone * 0.7;
      g = params.palette.landA[1] * tone;
      b = params.palette.landA[2] * tone * 0.6;
    } else {
      const tone = rng.range(0.55, 1.3);
      r = params.palette.rock[0] * tone;
      g = params.palette.rock[1] * tone;
      b = params.palette.rock[2] * tone;
    }

    const rKm = radiusKm + h / 1000 + (scaleM / 1000) * 0.25;
    data.push(
      dir.x * rKm - centerKm[0],
      dir.y * rKm - centerKm[1],
      dir.z * rKm - centerKm[2],
      scaleM / 1000,
      rng.range(0, 2 * Math.PI),
      shrub ? 1 : 0,
      r,
      g,
      b,
    );
  }
  return data.length > 0 ? new Float32Array(data) : null;
}
