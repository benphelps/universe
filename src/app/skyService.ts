import type { GalacticPosition } from '../universe/galaxy/density';
import type { SkyField } from '../universe/galaxy/skyfield';

/**
 * One shared sky-building worker with a small per-seed cache, so every
 * viewer of the same system reuses the same computed sky.
 */
const cache = new Map<string, Promise<SkyField>>();
let worker: Worker | null = null;
const waiting = new Map<string, (sky: SkyField) => void>();

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
    waiting.get(event.data.seedHex)?.(event.data.sky!);
    waiting.delete(event.data.seedHex);
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

export function getSkyField(seedHex: string, viewpoint: GalacticPosition): Promise<SkyField> {
  const key = `${seedHex}:${viewpoint.xPc.toFixed(4)},${viewpoint.yPc.toFixed(4)},${viewpoint.zPc.toFixed(4)}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = new Promise<SkyField>((resolve) => {
    waiting.set(seedHex, resolve);
    ensureWorker().postMessage({ seedHex, viewpoint });
  });
  cache.set(key, promise);
  if (cache.size > 4) {
    const oldest = cache.keys().next().value;
    if (oldest && oldest !== key) cache.delete(oldest);
  }
  return promise;
}
