import { seedFromHex } from '../core/rng/hash';
import { createSkyBakeGpu } from '../render/galaxy/skyBakeGpu';
import type { GalacticPosition } from '../universe/galaxy/density';
import { setGalaxySeed } from '../universe/galaxy/galaxySeed';
import {
  buildSkyBackground,
  type SkyBackground,
  type SkyMapBaker,
} from '../universe/galaxy/skyfield';

export interface BackgroundTask {
  seedHex: string;
  viewpoint: GalacticPosition;
  /** The session's galaxy, hex. */
  galaxy: string;
}

export interface BackgroundResult {
  seedHex: string;
  background: SkyBackground;
}

/**
 * The half of a sky the star sweep has no say in — gas, dust, chart
 * borders, and the unresolved glow — built on its own thread beside
 * the sweep rather than behind it.
 *
 * Its own worker because neither of the other two places would do. The
 * coordinator is the one dispatching slabs, and a couple of seconds of
 * glow on that thread stalls the whole pool near the sun where slabs
 * are short. A pool worker would take a slab's turn. This one is busy
 * for the first seconds of a build and idle after, which is exactly
 * when the pool has the most to do.
 */
/** The GPU baker of the background maps, tried once: null means this
 *  platform builds them on the CPU, and a baker that throws mid-build
 *  is demoted the same way. */
let baker: SkyMapBaker | null | undefined;

self.onmessage = (event: MessageEvent<BackgroundTask>) => {
  const { seedHex, viewpoint, galaxy } = event.data;
  setGalaxySeed(seedFromHex(galaxy));
  if (baker === undefined) baker = createSkyBakeGpu();
  let background: SkyBackground;
  try {
    background = buildSkyBackground(viewpoint, seedFromHex(seedHex), undefined, baker);
  } catch (error) {
    if (!baker) throw error;
    console.warn('sky GPU bake failed, building on the CPU:', error);
    baker.dispose();
    baker = null;
    background = buildSkyBackground(viewpoint, seedFromHex(seedHex));
  }
  const result: BackgroundResult = { seedHex, background };
  (self as unknown as Worker).postMessage(result, [
    background.nebulaAtlas.buffer,
    background.darkAtlas.buffer,
    background.groupStars.dirs.buffer,
    background.groupStars.colors.buffer,
    background.groupStars.brightness.buffer,
    background.groupStars.distances.buffer,
    background.groupStars.teffs.buffer,
    background.groupStars.seeds.buffer,
    background.sceneFromGalaxy.buffer,
    background.sectorBounds.buffer,
    background.sectorHomeBounds.buffer,
    background.glowData.buffer,
    background.riftData.buffer,
  ]);
};
