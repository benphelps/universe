import { seedFromHex, seedToHex } from '../core/rng/hash';
import { PRIME_GALAXY_SEED, setGalaxySeed } from '../universe/galaxy/galaxySeed';
import type { GalacticPosition } from '../universe/galaxy/density';
import { viewpointForSeed } from '../universe/galaxy/sectors';
import { CATALOG_ROWS } from '../universe/galaxy/catalog';
import type {
  GenerationAcquireMessage,
  GenerationGrantMessage,
  GenerationPriority,
  GenerationReleaseMessage,
} from '../app/generationScheduler';
import {
  assembleSkyField,
  catalogRowWeights,
  rowSlabPlan,
  rowSlabSpan,
  rowStageName,
  sweepRowSlab,
  type SkyBackground,
  type SkyBackgroundPreview,
  type SkyPreview,
  type SkyProgress,
  type SweepBounds,
  type SweepSlab,
} from '../universe/galaxy/skyfield';
import type { BackgroundResult, BackgroundTask } from './skyBackgroundWorker';
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
let backgroundWorker: Worker | null = null;
const backgroundWaiting = new Map<string, (background: SkyBackground) => void>();
let queue: Promise<void> = Promise.resolve();
let nextGenerationRequestId = 1;
const generationGrants = new Map<number, () => void>();

/** Ask the main thread's shared scheduler before occupying a CPU core. */
function acquireGeneration(priority: GenerationPriority): Promise<() => void> {
  const requestId = nextGenerationRequestId++;
  return new Promise((resolve) => {
    generationGrants.set(requestId, () => {
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        const message: GenerationReleaseMessage = { type: 'generation-release', requestId };
        (self as unknown as Worker).postMessage(message);
      });
    });
    const message: GenerationAcquireMessage = {
      type: 'generation-acquire',
      requestId,
      priority,
    };
    (self as unknown as Worker).postMessage(message);
  });
}

/**
 * Start the gas, dust and glow on their own thread and hand back a
 * promise for them. It is queued just after the visible-star permits,
 * so spare capacity still runs both side by side without allowing the
 * background to delay the first preview slabs.
 */
async function startBackground(
  seedHex: string,
  viewpoint: GalacticPosition,
  galaxy: string,
): Promise<SkyBackground | null> {
  try {
    backgroundWorker ??= new Worker(new URL('./skyBackgroundWorker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return null;
  }
  const worker = backgroundWorker;
  // Results are claimed by seed, not by whoever set the handler last.
  // Builds are serialised today so only one is ever outstanding, but a
  // single overwritten onmessage is a quiet way for a build to hang
  // forever the day that stops being true.
  worker.onmessage = (event: MessageEvent<BackgroundResult>) => {
    const claim = backgroundWaiting.get(event.data.seedHex);
    if (!claim) return;
    backgroundWaiting.delete(event.data.seedHex);
    claim(event.data.background);
  };
  const release = await acquireGeneration('background');
  return new Promise((resolve) => {
    backgroundWaiting.set(seedHex, (background) => {
      release();
      resolve(background);
    });
    const task: BackgroundTask = { seedHex, viewpoint, galaxy };
    worker.postMessage(task);
  });
}

function ensurePool(): Worker[] {
  if (pool) return pool;
  pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    pool.push(new Worker(new URL('./skySweepWorker.ts', import.meta.url), { type: 'module' }));
  }
  return pool;
}

interface PlannedSlab {
  row: (typeof CATALOG_ROWS)[number];
  bounds: SweepBounds;
  /** Which catalog row this came from — the stage it belongs to. */
  rowIndex: number;
}

/**
 * Every slab of every row, in the order the serial sweep would have
 * produced them.
 *
 * The build used to take one row at a time and wait for it, which put
 * a barrier at each of the six row boundaries and drained the pool at
 * every one — twice for nothing, since two of the rows are near-only
 * slices that finish in a tenth of a second. Planning the whole build
 * up front means a worker that runs dry on the last slab of one row
 * starts the next row's first slab instead of idling to the barrier.
 */
function planBuild(viewpoint: GalacticPosition, target: number): PlannedSlab[] {
  const planned: PlannedSlab[] = [];
  for (let rowIndex = 0; rowIndex < CATALOG_ROWS.length; rowIndex++) {
    const row = CATALOG_ROWS[rowIndex];
    for (const bounds of rowSlabPlan(row, viewpoint, target)) {
      planned.push({ row, bounds, rowIndex });
    }
  }
  return planned;
}

/**
 * The order to hand the plan out in, heaviest star first.
 *
 * Which slab a worker takes when has nothing to do with the sky that
 * comes out — results are filed by index, so the assembled field is
 * the serial sweep's whichever way this sorts. What it decides is the
 * order the sky arrives in on screen, and the catalogue is banded by
 * mass: sweeping the giants and the hot stars before the dwarfs puts
 * the stars a traveler would actually notice up first and thickens the
 * faint field in behind them, rather than laying down a haze and
 * hanging the landmarks on it at the end.
 *
 * It costs nothing to do this. The pool already runs at its own
 * makespan on this plan, and the heaviest row is second in the order
 * either way, so nothing is left waiting on a straggler.
 */
function dispatchOrder(planned: PlannedSlab[]): number[] {
  return planned
    .map((_, index) => index)
    .sort((a, b) => {
      const byMass = planned[b].row.massHi - planned[a].row.massHi;
      return byMass !== 0 ? byMass : a - b;
    });
}

/**
 * Run the whole plan across the pool. Slabs come back in whatever
 * order they finish and are filed by index, so the assembled sky is
 * the serial sweep's regardless of who got which piece or when.
 */
function sweepPlan(
  workers: Worker[],
  planned: PlannedSlab[],
  viewpoint: GalacticPosition,
  galaxy: string,
  onSlab: (done: number, furthestBehind: number, slab: SweepSlab) => void,
): Promise<SweepSlab[]> {
  const order = dispatchOrder(planned);
  return new Promise((resolve) => {
    const slabs: SweepSlab[] = new Array(planned.length);
    const filled = new Array<boolean>(planned.length).fill(false);
    let next = 0;
    let done = 0;
    let furthestBehind = 0;
    const dispatch = async (worker: Worker): Promise<void> => {
      if (next >= order.length) return;
      const taskId = order[next++];
      const task: SweepTask = {
        taskId,
        row: planned[taskId].row,
        viewpoint,
        galaxy,
        bounds: planned[taskId].bounds,
      };
      const release = await acquireGeneration('sky-preview');
      worker.onmessage = (event: MessageEvent<SweepResult>) => {
        release();
        slabs[event.data.taskId] = event.data.slab;
        filled[event.data.taskId] = true;
        done++;
        // The stage the build is furthest behind on: the row that owns
        // the earliest slab still outstanding.
        while (furthestBehind < planned.length && filled[furthestBehind]) furthestBehind++;
        onSlab(done, Math.min(furthestBehind, planned.length - 1), event.data.slab);
        if (done === planned.length) resolve(slabs);
        else void dispatch(worker);
      };
      worker.postMessage(task);
    };
    for (const worker of workers) void dispatch(worker);
  });
}

/**
 * Ship a finished slab's far stars for the traveler to look at while
 * the rest is still being swept.
 *
 * A copy, not the slab itself: the coordinator still needs these to
 * assemble the field, and transferring them would leave it holding
 * detached buffers. Only what a star needs to be drawn goes — where it
 * is, what colour, how bright, how far — not the seeds and effective
 * temperatures the finished field carries for everything else.
 *
 * Near stars are left out. They are the thirty-parsec neighbourhood,
 * which is on screen as its own points before the sky build even
 * starts, and sending them again would only double what is already
 * there.
 */
function sendPreview(seedHex: string, slab: SweepSlab): void {
  const { far } = slab;
  if (far.brightness.length === 0) return;
  const preview: SkyPreview = {
    seedHex,
    dirs: far.dirs.slice(),
    colors: far.colors.slice(),
    brightness: far.brightness.slice(),
    distances: far.distances.slice(),
  };
  (self as unknown as Worker).postMessage(preview, [
    preview.dirs.buffer,
    preview.colors.buffer,
    preview.brightness.buffer,
    preview.distances.buffer,
  ]);
}

/**
 * Hand the finished background to the main thread so it can be drawn
 * while the stars are still coming in. A copy, like the star slabs:
 * the coordinator still needs all of this to assemble the field.
 */
function sendBackgroundPreview(seedHex: string, background: SkyBackground): void {
  const preview: SkyBackgroundPreview = {
    seedHex,
    background: {
      ...background,
      nebulaAtlas: background.nebulaAtlas.slice(),
      darkAtlas: background.darkAtlas.slice(),
      groupStars: background.groupStars,
      sceneFromGalaxy: background.sceneFromGalaxy.slice(),
      sectorBounds: background.sectorBounds.slice(),
      sectorHomeBounds: background.sectorHomeBounds.slice(),
      glowData: background.glowData.slice(),
      riftData: background.riftData.slice(),
    },
  };
  (self as unknown as Worker).postMessage(preview, [
    preview.background.nebulaAtlas.buffer,
    preview.background.darkAtlas.buffer,
    preview.background.sceneFromGalaxy.buffer,
    preview.background.sectorBounds.buffer,
    preview.background.sectorHomeBounds.buffer,
    preview.background.glowData.buffer,
    preview.background.riftData.buffer,
  ]);
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
  let usePool = true;
  try {
    ensurePool();
  } catch {
    usePool = false;
  }

  let background: SkyBackground | undefined;
  let backgroundReady: Promise<SkyBackground | undefined> | null = null;
  const startBackgroundWork = (): Promise<SkyBackground | undefined> =>
    startBackground(seedHex, viewpoint, galaxy).then((built) => {
      if (!built) return undefined;
      background = built;
      // Ship it the moment it exists — the sky has something in it long
      // before the stars are finished arriving.
      sendBackgroundPreview(seedHex, built);
      return built;
    });

  if (usePool) {
    const workers = pool!;
    // Three slabs a worker is enough for the stragglers to be picked
    // up by whoever finishes first, and it is the whole build's worth
    // now rather than one row's.
    const planned = planBuild(viewpoint, workers.length * 3);
    // Progress is weighted by the rows the slabs belong to, so a row
    // the catalogue knows is cheap cannot pretend to be a third of the
    // build just because it holds a third of the slabs.
    const perSlab = planned.map((slab) => {
      const inRow = planned.filter((other) => other.rowIndex === slab.rowIndex).length;
      return weights[slab.rowIndex] / inRow;
    });
    const totalWeight = perSlab.reduce((sum, w) => sum + w, 0) || 1;
    let doneWeight = 0;
    let lastDone = 0;
    const builtPending = sweepPlan(
      workers,
      planned,
      viewpoint,
      galaxy,
      (done, furthestBehind, slab) => {
        for (let i = lastDone; i < done; i++) doneWeight += perSlab[i] ?? 0;
        lastDone = done;
        const stage = rowStageName(planned[furthestBehind].row);
        report(0.84 * (doneWeight / totalWeight), stage, done / planned.length);
        sendPreview(seedHex, slab);
      },
    );
    // Preview permits enter the shared queue before the lower-priority
    // background, while spare capacity can still run both together.
    backgroundReady = startBackgroundWork();
    const built = await builtPending;
    slabs.push(...built);
  } else {
    const releasePending = acquireGeneration('sky-preview');
    backgroundReady = startBackgroundWork();
    const release = await releasePending;
    try {
      let rowsBehind = 0;
      for (let i = 0; i < CATALOG_ROWS.length; i++) {
        const row = CATALOG_ROWS[i];
        const stage = rowStageName(row);
        report(0.84 * rowsBehind, stage, 0);
        const span = rowSlabSpan(row, viewpoint);
        slabs.push(
          sweepRowSlab(row, viewpoint, { ixLo: span.lo, ixHi: span.hi }, (fraction) =>
            report(0.84 * (rowsBehind + weights[i] * fraction), stage, fraction),
          ),
        );
        rowsBehind += weights[i];
      }
    } finally {
      release();
    }
  }

  backgroundReady ??= startBackgroundWork();
  await backgroundReady;
  const release = await acquireGeneration('background');
  try {
    const sky = assembleSkyField(viewpoint, seed, slabs, report, background);
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
  } finally {
    release();
  }
}

self.onmessage = (event: MessageEvent<SkyRequest | GenerationGrantMessage>) => {
  if ('type' in event.data) {
    const grant = generationGrants.get(event.data.requestId);
    generationGrants.delete(event.data.requestId);
    grant?.();
    return;
  }
  const { seedHex, viewpoint, galaxy } = event.data;
  const seed = seedFromHex(seedHex);
  if (galaxy) setGalaxySeed(seedFromHex(galaxy));
  const galaxyHex = galaxy ?? seedToHex(PRIME_GALAXY_SEED);
  queue = queue.then(() =>
    runBuild(seedHex, viewpoint ?? viewpointForSeed(seed), seed, galaxyHex),
  );
};
