import { seedFromHex } from '../core/rng/hash';
import { viewpointForSeed } from '../universe/galaxy/sectors';
import { buildSkyField } from '../universe/galaxy/skyfield';

export interface SkyRequest {
  seedHex: string;
}

/** Builds a system's sky off the frame loop; arrays return as transferables. */
self.onmessage = (event: MessageEvent<SkyRequest>) => {
  const { seedHex } = event.data;
  const sky = buildSkyField(viewpointForSeed(seedFromHex(seedHex)));
  (self as unknown as Worker).postMessage({ seedHex, sky }, [
    sky.starDirs.buffer,
    sky.starColors.buffer,
    sky.starBrightness.buffer,
    sky.nebulaAtlas.buffer,
    sky.glowData.buffer,
    sky.riftData.buffer,
  ]);
};
