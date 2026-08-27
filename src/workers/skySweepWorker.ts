import type { GalacticPosition } from '../universe/galaxy/density';
import { sweepRowSlab, type SweepSlab } from '../universe/galaxy/skyfield';
import type { CatalogRow } from '../universe/galaxy/catalog';

export interface SweepTask {
  taskId: number;
  row: CatalogRow;
  viewpoint: GalacticPosition;
  ixLo: number;
  ixHi: number;
}

export interface SweepResult {
  taskId: number;
  slab: SweepSlab;
}

/** One slab of one catalog row's star sweep — the parallel unit the
 *  sky coordinator farms out. */
self.onmessage = (event: MessageEvent<SweepTask>) => {
  const { taskId, row, viewpoint, ixLo, ixHi } = event.data;
  const slab = sweepRowSlab(row, viewpoint, ixLo, ixHi);
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
