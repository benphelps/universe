import { seedFromHex } from '../core/rng/hash';
import type { GalacticPosition } from '../universe/galaxy/density';
import { viewpointForSeed } from '../universe/galaxy/sectors';
import { buildSkyField } from '../universe/galaxy/skyfield';

export interface SkyRequest {
  seedHex: string;
  /** The system's true locale (catalog travel); absent for bare seeds. */
  viewpoint?: GalacticPosition;
}

/** Builds a system's sky off the frame loop; arrays return as transferables. */
self.onmessage = (event: MessageEvent<SkyRequest>) => {
  const { seedHex, viewpoint } = event.data;
  const seed = seedFromHex(seedHex);
  const sky = buildSkyField(viewpoint ?? viewpointForSeed(seed), seed);
  (self as unknown as Worker).postMessage({ seedHex, sky }, [
    sky.starDirs.buffer,
    sky.starColors.buffer,
    sky.starBrightness.buffer,
    sky.starDistances.buffer,
    sky.starTeffs.buffer,
    sky.starSeeds.buffer,
    sky.sectorBounds.buffer,
    sky.sectorHomeBounds.buffer,
    sky.constellationBounds.buffer,
    sky.nebulaAtlas.buffer,
    sky.glowData.buffer,
    sky.riftData.buffer,
    sky.darkAtlas.buffer,
  ]);
};
