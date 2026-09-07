import { seedFromHex } from '../core/rng/hash';
import { createNebulaGpuBaker, type NebulaGpuBaker } from '../render/galaxy/nebulaBakeGpu';
import { cloudsNear } from '../universe/galaxy/clouds';
import type { GalacticPosition } from '../universe/galaxy/density';
import { setGalaxySeed } from '../universe/galaxy/galaxySeed';
import { nebulaFor } from '../universe/galaxy/nebula';
import { bakeNebulaPair, type NebulaVolumePair } from '../universe/galaxy/nebulaPair';

export interface NebulaBakeTask {
  /** The session's galaxy, hex. */
  galaxy: string;
  /** The cloud's own position — enough to find it again, since the
   *  population is a pure function of the galaxy seed. */
  positionPc: GalacticPosition;
  seedHex: string;
  /** Identifies the request — a cloud can be asked for at more than
   *  one scale, and the answers are different volumes. */
  key: string;
  size: number;
  /** Source-aware live-array estimate, computed before pool admission. */
  workingBytes?: number;
  /** Explicit benchmark attribution; ordinary bakes do not time phases. */
  audit?: boolean;
}

export interface NebulaBakeResult {
  key: string;
  pair: NebulaVolumePair | null;
  metrics?: { totalMs: number; sampleMs: number; attenuateMs: number; gpu: boolean; storageBytes: number; readbackBytes: number };
}

/** The GPU baker, tried once: null means this platform marches on the
 *  CPU, and a baker that throws mid-bake is demoted the same way. */
let baker: NebulaGpuBaker | null | undefined;

/**
 * The nebula bake: a cloud's density field on a grid with its group's
 * ionizing budget spent through it. GPU sampling accelerates the gas
 * field, but the coupled transport solve still costs seconds — either way
 * off the frame thread, and the camera can leave before it lands.
 */
self.onmessage = (event: MessageEvent<NebulaBakeTask>) => {
  const audit = event.data.audit;
  const started = audit ? performance.now() : 0;
  let sampleMs = 0, attenuateMs = 0;
  const { galaxy, positionPc, seedHex, key, size } = event.data;
  setGalaxySeed(seedFromHex(galaxy));
  const seed = seedFromHex(seedHex);
  const cloud = cloudsNear(positionPc, 1).find((candidate) => candidate.seed === seed);
  // A cloud that never formed stars is still a body worth drawing: the
  // dark rifts are the same objects, unlit.
  const nebula = cloud ? nebulaFor(cloud) : null;
  let pair: NebulaVolumePair | null = null;
  if (cloud) {
    if (baker === undefined) baker = createNebulaGpuBaker();
    if (baker) {
      try {
        pair = bakeNebulaPair(cloud, nebula, size,
          audit ? plan => { const at = performance.now(); const fields = baker!.sample(plan); sampleMs += performance.now() - at; return fields; } : baker.sample,
          audit ? (plan, fields) => { const at = performance.now(); baker!.attenuate(plan, fields); attenuateMs += performance.now() - at; } : baker.attenuate);
      } catch (error) {
        console.warn('nebula GPU bake failed, marching on the CPU:', error);
        baker.dispose();
        baker = null;
      }
    }
    pair ??= bakeNebulaPair(cloud, nebula, size);
  }
  const result: NebulaBakeResult = { key, pair };
  if (audit) result.metrics = { totalMs: performance.now() - started, sampleMs, attenuateMs,
    gpu: !!baker, storageBytes: baker?.storageBytes ?? 0, readbackBytes: baker?.readbackBytes ?? 0 };
  const bakes = pair ? [pair.coarse, ...(pair.fine ? [pair.fine] : [])] : [];
  (self as unknown as Worker).postMessage(
    result,
    bakes.flatMap(bake => [bake.data.buffer, bake.occupancy.buffer, ...(bake.continuum ? [bake.continuum.data.buffer] : [])]),
  );
};
