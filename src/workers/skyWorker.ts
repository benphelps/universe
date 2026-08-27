import { seedFromHex, seedToHex } from '../core/rng/hash';
import { PRIME_GALAXY_SEED, setGalaxySeed } from '../universe/galaxy/galaxySeed';
import type { GalacticPosition } from '../universe/galaxy/density';
import { viewpointForSeed } from '../universe/galaxy/sectors';
import { CATALOG_ROWS } from '../universe/galaxy/catalog';
import {
  assembleSkyField,
  catalogRowWeights,
  rowSlabSpan,
  rowStageName,
  sweepRowSlab,
  type SkyProgress,
  type SweepSlab,
} from '../universe/galaxy/skyfield';
import type { SweepResult, SweepTask } from './skySweepWorker';

export interface SkyRequest {
  seedHex: string;
  /** The system's true locale (catalog travel); absent for bare seeds. */
  viewpoint?: GalacticPosition;
  /** The session's galaxy; absent means the prime galaxy. */
  galaxy?: string;
}

/**
 * The sky coordinator: the star sweep — the bulk of a sky build — is
 * farmed out as row slabs across a small worker pool, one catalog row
 * at a time so the progress stage stays truthful; the tail (groups,
 * clouds, charts, glow) runs here. Per-cell seeding makes any slab
 * partition byte-identical to the serial sweep, so parallelism cannot
 * change the sky. Requests queue: one build at a time owns the pool.
 */
const POOL_SIZE = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 2));
let pool: Worker[] | null = null;
let queue: Promise<void> = Promise.resolve();

function ensurePool(): Worker[] {
  if (pool) return pool;
  pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    pool.push(new Worker(new URL('./skySweepWorker.ts', import.meta.url), { type: 'module' }));
  }
  return pool;
}

/** Run one row's sweep across the pool; slabs return in slab order. */
function sweepRowParallel(
  workers: Worker[],
  row: (typeof CATALOG_ROWS)[number],
  viewpoint: GalacticPosition,
  galaxy: string,
  onChunk: (done: number, total: number) => void,
): Promise<SweepSlab[]> {
  const span = rowSlabSpan(row, viewpoint);
  const width = span.hi - span.lo + 1;
  const chunkCount = Math.max(1, Math.min(workers.length * 3, width));
  const bounds: Array<{ ixLo: number; ixHi: number }> = [];
  for (let c = 0; c < chunkCount; c++) {
    bounds.push({
      ixLo: span.lo + Math.floor((c * width) / chunkCount),
      ixHi: span.lo + Math.floor(((c + 1) * width) / chunkCount) - 1,
    });
  }
  return new Promise((resolve) => {
    const slabs: SweepSlab[] = new Array(chunkCount);
    let next = 0;
    let done = 0;
    const dispatch = (worker: Worker): void => {
      if (next >= chunkCount) return;
      const taskId = next++;
      const task: SweepTask = { taskId, row, viewpoint, galaxy, ...bounds[taskId] };
      worker.onmessage = (event: MessageEvent<SweepResult>) => {
        slabs[event.data.taskId] = event.data.slab;
        done++;
        onChunk(done, chunkCount);
        if (done === chunkCount) resolve(slabs);
        else dispatch(worker);
      };
      worker.postMessage(task);
    };
    for (const worker of workers) dispatch(worker);
  });
}

async function runBuild(
  seedHex: string,
  viewpoint: GalacticPosition,
  seed: bigint,
  galaxy: string,
): Promise<void> {
  let lastFraction = 0;
  let lastStage = '';
  let lastStageFraction = 0;
  const report: SkyProgress = (fraction, stage, stageFraction) => {
    if (
      stage === lastStage &&
      fraction - lastFraction < 0.01 &&
      Math.abs(stageFraction - lastStageFraction) < 0.04
    ) {
      return;
    }
    lastFraction = fraction;
    lastStage = stage;
    lastStageFraction = stageFraction;
    (self as unknown as Worker).postMessage({ seedHex, progress: fraction, stage, stageFraction });
  };

  const weights = catalogRowWeights();
  const slabs: SweepSlab[] = [];
  let rowsBehind = 0;
  let usePool = true;
  try {
    ensurePool();
  } catch {
    usePool = false;
  }
  for (let i = 0; i < CATALOG_ROWS.length; i++) {
    const row = CATALOG_ROWS[i];
    const stage = rowStageName(row);
    report(0.84 * rowsBehind, stage, 0);
    if (usePool) {
      const rowSlabs = await sweepRowParallel(pool!, row, viewpoint, galaxy, (done, total) =>
        report(0.84 * (rowsBehind + (weights[i] * done) / total), stage, done / total),
      );
      slabs.push(...rowSlabs);
    } else {
      const span = rowSlabSpan(row, viewpoint);
      slabs.push(
        sweepRowSlab(row, viewpoint, span.lo, span.hi, (fraction) =>
          report(0.84 * (rowsBehind + weights[i] * fraction), stage, fraction),
        ),
      );
    }
    rowsBehind += weights[i];
  }

  const sky = assembleSkyField(viewpoint, seed, slabs, report);
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
}

self.onmessage = (event: MessageEvent<SkyRequest>) => {
  const { seedHex, viewpoint, galaxy } = event.data;
  const seed = seedFromHex(seedHex);
  if (galaxy) setGalaxySeed(seedFromHex(galaxy));
  const galaxyHex = galaxy ?? seedToHex(PRIME_GALAXY_SEED);
  queue = queue.then(() =>
    runBuild(seedHex, viewpoint ?? viewpointForSeed(seed), seed, galaxyHex),
  );
};
