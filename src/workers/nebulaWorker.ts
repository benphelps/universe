import { seedFromHex } from '../core/rng/hash';
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
  size: number;
}

export interface NebulaBakeResult {
  seedHex: string;
  bake: NebulaVolumeBake | null;
}

/**
 * The nebula bake: a cloud's density field on a grid with its group's
 * ionizing budget spent through it. Seconds of work for one object, and
 * the camera can leave before it lands — its own worker so it never
 * stands in front of the sky, and one bake at a time.
 */
self.onmessage = (event: MessageEvent<NebulaBakeTask>) => {
  const { galaxy, positionPc, seedHex, size } = event.data;
  setGalaxySeed(seedFromHex(galaxy));
  const seed = seedFromHex(seedHex);
  const cloud = cloudsNear(positionPc, 1).find((candidate) => candidate.seed === seed);
  const nebula = cloud ? nebulaFor(cloud) : null;
  const bake = nebula ? bakeNebulaVolume(nebula, size) : null;
  const result: NebulaBakeResult = { seedHex, bake };
  (self as unknown as Worker).postMessage(result, bake ? [bake.data.buffer] : []);
};
