import { seedToHex } from '../core/rng/hash';
import type { GalacticPosition } from '../universe/galaxy/density';
import { galaxySeed } from '../universe/galaxy/galaxySeed';
import type {
  SkyBackground,
  SkyField,
  SkyPreview,
} from '../universe/galaxy/skyfield';

/**
 * One shared sky-building worker with a small per-seed cache, so every
 * viewer of the same system reuses the same computed sky.
 */
const cache = new Map<string, Promise<SkyField>>();
let worker: Worker | null = null;
const waiting = new Map<string, (sky: SkyField) => void>();
/** Who wants to draw slabs as they land, per seed. */
const watching = new Map<string, (preview: SkyPreview) => void>();
/** Who wants the gas and glow as soon as it exists, per seed. */
const watchingBackground = new Map<string, (background: SkyBackground) => void>();

export interface SkyBuildProgress {
  fraction: number;
  stage: string;
  /** Progress within the stage; −1 when the stage has no measure. */
  stageFraction: number;
}

const progress = new Map<string, SkyBuildProgress>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/skyWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (
    event: MessageEvent<{
      seedHex: string;
      sky?: SkyField;
      progress?: number;
      stage?: string;
      stageFraction?: number;
      dirs?: Float32Array;
      background?: SkyBackground;
    }>,
  ) => {
    if (event.data.progress !== undefined) {
      progress.set(event.data.seedHex, {
        fraction: event.data.progress,
        stage: event.data.stage ?? '',
        stageFraction: event.data.stageFraction ?? -1,
      });
      return;
    }
    // A slab of far stars, on its way to the screen ahead of the rest.
    if (event.data.dirs) {
      watching.get(event.data.seedHex)?.(event.data as unknown as SkyPreview);
      return;
    }
    // The gas, dust and glow, which the stars have no say in.
    if (event.data.background) {
      watchingBackground.get(event.data.seedHex)?.(event.data.background);
      return;
    }
    waiting.get(event.data.seedHex)?.(event.data.sky!);
    waiting.delete(event.data.seedHex);
    watching.delete(event.data.seedHex);
    watchingBackground.delete(event.data.seedHex);
    progress.delete(event.data.seedHex);
  };
  return worker;
}

/** Sky builds still in the worker — the arrival star field's lag. */
export function skyPending(): number {
  return waiting.size;
}

/** Rough progress of the running sky build. The worker is serial, so
 *  the oldest pending request is the one actually building; later
 *  requests are queued behind it and report when their turn comes. */
export function skyProgress(): SkyBuildProgress {
  const running = waiting.keys().next();
  if (running.done) return { fraction: 1, stage: '', stageFraction: -1 };
  return progress.get(running.value) ?? { fraction: 0, stage: '', stageFraction: -1 };
}

/**
 * Abandon every sky build in flight.
 *
 * The worker is serial and has no way of being told to stop, so
 * stopping it means ending it — the right trade whenever the answer has
 * stopped being wanted. Diving to a galaxy's centre leaves that
 * system's sky building for a viewpoint nobody is standing at any more,
 * and so does travelling on to the next star: work that will be thrown
 * away when it lands, a progress bar counting toward it, and a queue
 * the next request has to wait behind.
 */
export function cancelSkyBuilds(): void {
  if (!worker) return;
  worker.terminate();
  worker = null;
  watching.clear();
  watchingBackground.clear();
  // A promise whose worker is gone never settles, so it must not be
  // left in the cache for the next caller to await forever.
  for (const seedHex of waiting.keys()) {
    for (const key of [...cache.keys()]) {
      if (key.startsWith(`${seedHex}:`)) cache.delete(key);
    }
  }
  waiting.clear();
  progress.clear();
}

/**
 * Draw this build's stars as its slabs land, rather than waiting for
 * the whole field. Registered before the request so nothing is missed;
 * dropped when the field arrives, since by then the caller has all of
 * it. A cached sky never streams — there is nothing to wait through.
 */
export function watchSkyBuild(
  seedHex: string,
  onPreview: (preview: SkyPreview) => void,
  onBackground?: (background: SkyBackground) => void,
): void {
  watching.set(seedHex, onPreview);
  if (onBackground) watchingBackground.set(seedHex, onBackground);
}

export function getSkyField(seedHex: string, viewpoint: GalacticPosition): Promise<SkyField> {
  const key = `${seedHex}:${viewpoint.xPc.toFixed(4)},${viewpoint.yPc.toFixed(4)},${viewpoint.zPc.toFixed(4)}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = new Promise<SkyField>((resolve) => {
    waiting.set(seedHex, resolve);
    ensureWorker().postMessage({ seedHex, viewpoint, galaxy: seedToHex(galaxySeed()) });
  });
  cache.set(key, promise);
  if (cache.size > 4) {
    const oldest = cache.keys().next().value;
    if (oldest && oldest !== key) cache.delete(oldest);
  }
  return promise;
}
