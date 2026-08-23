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

export function getSkyField(seedHex: string): Promise<SkyField> {
  const cached = cache.get(seedHex);
  if (cached) return cached;
  const promise = new Promise<SkyField>((resolve) => {
    waiting.set(seedHex, resolve);
    ensureWorker().postMessage({ seedHex });
  });
  cache.set(seedHex, promise);
  if (cache.size > 4) {
    const oldest = cache.keys().next().value;
    if (oldest && oldest !== seedHex) cache.delete(oldest);
  }
  return promise;
}
