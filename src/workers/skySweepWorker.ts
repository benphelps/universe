import { seedFromHex } from '../core/rng/hash';
import type { GalacticPosition } from '../universe/galaxy/density';
import { setGalaxySeed } from '../universe/galaxy/galaxySeed';
import { sweepRowSlab, type SweepBounds, type SweepSlab } from '../universe/galaxy/skyfield';
import type { CatalogRow } from '../universe/galaxy/catalog';

export interface SweepTask {
  taskId: number;
  row: CatalogRow;
  viewpoint: GalacticPosition;
  /** The session's galaxy, hex. */
  galaxy: string;
  bounds: SweepBounds;
}

export interface SweepResult {
  taskId: number;
  slab: SweepSlab;
}

/** One slab of one catalog row's star sweep — the parallel unit the
 *  sky coordinator farms out. */
self.onmessage = (event: MessageEvent<SweepTask>) => {
  const { taskId, row, viewpoint, galaxy, bounds } = event.data;
  setGalaxySeed(seedFromHex(galaxy));
  const slab = sweepRowSlab(row, viewpoint, bounds);
  const result: SweepResult = { taskId, slab };
  (self as unknown as Worker).postMessage(result, [
    slab.near.dirs.buffer,
    slab.near.colors.buffer,
    slab.near.brightness.buffer,
    slab.near.distances.buffer,
    slab.near.teffs.buffer,
    slab.near.seeds.buffer,
    slab.far.dirs.buffer,
    slab.far.colors.buffer,
    slab.far.brightness.buffer,
    slab.far.distances.buffer,
    slab.far.teffs.buffer,
    slab.far.seeds.buffer,
  ]);
};
