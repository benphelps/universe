import type { GalacticPosition } from '../universe/galaxy/density';
import type { SkyField } from '../universe/galaxy/skyfield';

/**
 * One shared sky-building worker with a small per-seed cache, so every
 * viewer of the same system reuses the same computed sky.
 */
const cache = new Map<string, Promise<SkyField>>();
let worker: Worker | null = null;
const waiting = new Map<string, (sky: SkyField) => void>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/skyWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ seedHex: string; sky: SkyField }>) => {
    waiting.get(event.data.seedHex)?.(event.data.sky);
    waiting.delete(event.data.seedHex);
  };
  return worker;
}

/** Sky builds still in the worker — the arrival star field's lag. */
export function skyPending(): number {
  return waiting.size;
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
