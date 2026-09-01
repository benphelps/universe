import {
  ClampToEdgeWrapping,
  Data3DTexture,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  RedFormat,
  RepeatWrapping,
  RGFormat,
  UnsignedByteType,
} from 'three';
import { seedToHex } from '../../core/rng/hash';
import { ARM_LUT_SIZE } from '../../universe/galaxy/armLut';
import { galaxySeed } from '../../universe/galaxy/galaxySeed';
import type { GalaxyLutResult } from '../../workers/galaxyLutWorker';
import { CLUMP_TILE_SIZE } from './clumpTile';

export interface GalaxyLuts {
  /** armProfile on a polar grid: boost in R, lane in G. Azimuth wraps
   *  across, log radius clamps down — the edge rows hold zeros. */
  armLut: DataTexture;
  /** The tiling clump-noise field, repeat-wrapped on every axis. */
  clumpTile: Data3DTexture;
}

let memo: GalaxyLuts | null = null;

/**
 * The march's lookup tables, handed out immediately and filled when
 * the worker's bake lands. The textures never change identity — the
 * bake writes into their own buffers — so a material binds them once
 * and needs no callback. Until the data arrives they hold zeros: an
 * armless, clumpless disk for the first fraction of a second, which is
 * the model's smooth component and nothing false.
 */
export function galaxyLutTextures(): GalaxyLuts {
  if (memo) return memo;

  const armLut = new DataTexture(
    new Uint16Array(ARM_LUT_SIZE * ARM_LUT_SIZE * 2),
    ARM_LUT_SIZE,
    ARM_LUT_SIZE,
    RGFormat,
    HalfFloatType,
  );
  armLut.minFilter = LinearFilter;
  armLut.magFilter = LinearFilter;
  armLut.wrapS = RepeatWrapping;
  armLut.wrapT = ClampToEdgeWrapping;
  armLut.needsUpdate = true;

  const clumpTile = new Data3DTexture(
    new Uint8Array(CLUMP_TILE_SIZE ** 3),
    CLUMP_TILE_SIZE,
    CLUMP_TILE_SIZE,
    CLUMP_TILE_SIZE,
  );
  clumpTile.format = RedFormat;
  clumpTile.type = UnsignedByteType;
  clumpTile.minFilter = LinearFilter;
  clumpTile.magFilter = LinearFilter;
  clumpTile.wrapS = RepeatWrapping;
  clumpTile.wrapT = RepeatWrapping;
  clumpTile.wrapR = RepeatWrapping;
  clumpTile.needsUpdate = true;

  memo = { armLut, clumpTile };

  // Outside a browser (tests) there is no worker to bake; the zeroed
  // tables are already the documented not-yet-baked state.
  if (typeof Worker === 'undefined') return memo;

  const worker = new Worker(new URL('../../workers/galaxyLutWorker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = (event: MessageEvent<GalaxyLutResult>) => {
    const half = armLut.image.data as Uint16Array;
    const baked = event.data.armLut;
    for (let i = 0; i < baked.length; i++) half[i] = DataUtils.toHalfFloat(baked[i]);
    (clumpTile.image.data as Uint8Array).set(event.data.clumpTile);
    armLut.needsUpdate = true;
    clumpTile.needsUpdate = true;
    worker.terminate();
  };
  worker.postMessage({ galaxy: seedToHex(galaxySeed()) });
  return memo;
}
