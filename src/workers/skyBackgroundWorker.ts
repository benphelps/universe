import { seedFromHex } from '../core/rng/hash';
import { createSkyBakeGpu } from '../render/galaxy/skyBakeGpu';
import type { GalacticPosition } from '../universe/galaxy/density';
import { setGalaxySeed } from '../universe/galaxy/galaxySeed';
import type { NebulaVolumePair } from '../universe/galaxy/nebulaPair';
import { refineNebulaPortrait, type NebulaPortrait } from '../universe/galaxy/nebulaPortrait';
import {
  planSkyBackground, buildNebulaPatch, nebulaTileFromAtlas,
  NEBULA_ATLAS_COLS, NEBULA_ATLAS_ROWS, NEBULA_TILE,
  type NebulaCandidate, type SkyBackground, type SkyMapBaker, type SkyPortraitUpdate,
} from '../universe/galaxy/skyfield';

export type BackgroundTask = { id: number; galaxy: string } & (
  { kind: 'base'; seedHex: string; viewpoint: GalacticPosition } |
  { kind: 'portrait'; candidate: NebulaCandidate; tile: number; size: number; pair: NebulaVolumePair;
    previous?: NebulaPortrait['luminosities']; sizes: number[]; lastGrade?: boolean }
);
export type BackgroundResult = { id: number } & (
  { base: { background: SkyBackground; jobs: NebulaCandidate[] } } |
  { measured: NebulaPortrait['luminosities']; sizes: number[]; portrait?: SkyPortraitUpdate } |
  { progress: number; stage: string; stageFraction: number }
);

/** One bounded map/photometry worker. It holds a permit only while doing
 * work; gas solves use the same three-worker pool as resident volumes. */
let baker: SkyMapBaker | null | undefined;
function withBaker<T>(work: (baker: SkyMapBaker | null) => T): T {
  if (baker === undefined) baker = createSkyBakeGpu();
  try { return work(baker); }
  catch (error) {
    if (!baker) throw error;
    console.warn('sky GPU bake failed, retrying this map on the CPU:', error);
    baker.dispose(); baker = null;
    return work(null);
  }
}
const post = (result: BackgroundResult, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(result, transfer);
self.onmessage = (event: MessageEvent<BackgroundTask>) => {
  const task = event.data;
  setGalaxySeed(seedFromHex(task.galaxy));
  if (task.kind === 'base') {
    const base = withBaker(baker => planSkyBackground(task.viewpoint, seedFromHex(task.seedHex),
      (progress, stage, stageFraction) => post({ id: task.id, progress, stage, stageFraction }), baker));
    const b = base.background;
    post({ id: task.id, base }, [b.nebulaAtlas.buffer, b.darkAtlas.buffer,
      b.groupStars.dirs.buffer, b.groupStars.colors.buffer, b.groupStars.brightness.buffer,
      b.groupStars.distances.buffer, b.groupStars.teffs.buffer, b.groupStars.seeds.buffer,
      b.sceneFromGalaxy.buffer, b.sectorBounds.buffer, b.sectorHomeBounds.buffer, b.glowData.buffer, b.riftData.buffer]);
    return;
  }
  const measured = refineNebulaPortrait(task.pair, task.previous, task.sizes);
  const refinement = measured.refinement!;
  if (!refinement.converged && !(task.lastGrade ?? task.size >= 96)) {
    post({ id: task.id, measured: measured.luminosities, sizes: refinement.sizes });
    return;
  }
  const atlas = new Float32Array(NEBULA_ATLAS_COLS * NEBULA_ATLAS_ROWS * NEBULA_TILE ** 2 * 4);
  const patch = withBaker(baker => buildNebulaPatch(task.candidate, task.tile, atlas, baker, measured));
  const pixels = nebulaTileFromAtlas(atlas, task.tile);
  post({ id: task.id, measured: measured.luminosities, sizes: refinement.sizes, portrait: { patch, pixels } }, [pixels.buffer]);
};
