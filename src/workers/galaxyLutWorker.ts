import { seedFromHex } from '../core/rng/hash';
import { bakeClumpTile } from '../render/galaxy/clumpTile';
import { bakeArmLut } from '../universe/galaxy/armLut';
import { getGalaxyParticles, type GalaxyParticleSet } from '../universe/galaxy/particles';
import { setGalaxySeed } from '../universe/galaxy/galaxySeed';

export interface GalaxyLutTask {
  /** The session's galaxy, hex — the arm profile belongs to it. */
  galaxy: string;
}

export interface GalaxyLutResult {
  /** Interleaved (boost, lane) rows, ARM_LUT_SIZE². */
  armLut: Float32Array;
  particles: GalaxyParticleSet;
  /** The clump noise tile, CLUMP_TILE_SIZE³ bytes. */
  clumpTile: Uint8Array;
}

/**
 * Shared arm/noise lookup tables and bounded optical source samples,
 * once per galaxy. Their construction stays off the main thread;
 * population quadrature is generated offline, never in this worker.
 */
self.onmessage = (event: MessageEvent<GalaxyLutTask>) => {
  setGalaxySeed(seedFromHex(event.data.galaxy));
  const result: GalaxyLutResult = { armLut: bakeArmLut(), clumpTile: bakeClumpTile(), particles: getGalaxyParticles() };
  (self as unknown as Worker).postMessage(result, [result.armLut.buffer, result.clumpTile.buffer, result.particles.positionsPc.buffer, result.particles.opticalRgb.buffer]);
};
