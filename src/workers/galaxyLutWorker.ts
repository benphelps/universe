import { seedFromHex } from '../core/rng/hash';
import { bakeClumpTile } from '../render/galaxy/clumpTile';
import { bakeArmLut } from '../universe/galaxy/armLut';
import { setGalaxySeed } from '../universe/galaxy/galaxySeed';

export interface GalaxyLutTask {
  /** The session's galaxy, hex — the arm profile belongs to it. */
  galaxy: string;
}

export interface GalaxyLutResult {
  /** Interleaved (boost, lane) rows, ARM_LUT_SIZE². */
  armLut: Float32Array;
  /** The clump noise tile, CLUMP_TILE_SIZE³ bytes. */
  clumpTile: Uint8Array;
}

/**
 * The galaxy march's lookup tables: half a second of orbit-family
 * inversions and noise evaluation, once per galaxy — off the main
 * thread so arriving in a galaxy never hitches on it.
 */
self.onmessage = (event: MessageEvent<GalaxyLutTask>) => {
  setGalaxySeed(seedFromHex(event.data.galaxy));
  const result: GalaxyLutResult = { armLut: bakeArmLut(), clumpTile: bakeClumpTile() };
  (self as unknown as Worker).postMessage(result, [result.armLut.buffer, result.clumpTile.buffer]);
};
