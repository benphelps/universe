import { seedFromHex } from '../core/rng/hash';
import { createNebulaGpuBaker, type NebulaGpuBaker } from '../render/galaxy/nebulaBakeGpu';
import { cloudsNear } from '../universe/galaxy/clouds';
import type { GalacticPosition } from '../universe/galaxy/density';
import { setGalaxySeed } from '../universe/galaxy/galaxySeed';
import { nebulaFor } from '../universe/galaxy/nebula';
import { bakeNebulaVolume, type NebulaVolumeBake } from '../universe/galaxy/nebulaVolume';

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
  /** Half-extent of the box, pc; absent bakes the ionized bubble. */
  boxPc?: number;
}

export interface NebulaBakeResult {
  key: string;
  bake: NebulaVolumeBake | null;
}

/** The GPU baker, tried once: null means this platform marches on the
 *  CPU, and a baker that throws mid-bake is demoted the same way. */
let baker: NebulaGpuBaker | null | undefined;

/**
 * The nebula bake: a cloud's density field on a grid with its group's
 * ionizing budget spent through it. Rendered in milliseconds where the
 * worker can reach a GPU; seconds of CPU where it cannot — either way
 * off the frame thread, and the camera can leave before it lands.
 */
self.onmessage = (event: MessageEvent<NebulaBakeTask>) => {
  const { galaxy, positionPc, seedHex, key, size, boxPc } = event.data;
  setGalaxySeed(seedFromHex(galaxy));
  const seed = seedFromHex(seedHex);
  const cloud = cloudsNear(positionPc, 1).find((candidate) => candidate.seed === seed);
  // A cloud that never formed stars is still a body worth drawing: the
  // dark rifts are the same objects, unlit.
  const nebula = cloud ? nebulaFor(cloud) : null;
  let bake: NebulaVolumeBake | null = null;
  if (cloud) {
    if (baker === undefined) baker = createNebulaGpuBaker();
    if (baker) {
      try {
        bake = baker.bake(cloud, nebula, size, boxPc);
      } catch (error) {
        console.warn('nebula GPU bake failed, marching on the CPU:', error);
        baker.dispose();
        baker = null;
      }
    }
    bake ??= bakeNebulaVolume(cloud, nebula, size, boxPc);
  }
  const result: NebulaBakeResult = { key, bake };
  (self as unknown as Worker).postMessage(
    result,
    bake ? [bake.data.buffer, bake.occupancy.buffer] : [],
  );
};
