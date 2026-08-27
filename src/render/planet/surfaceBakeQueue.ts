import type { Characterization } from '../../universe/planet/types';
import type {
  SurfaceBakeRequest,
  SurfaceBakeResponse,
} from '../../workers/surfaceBakeWorker';

interface BakeJob {
  request: SurfaceBakeRequest;
  resolve: (result: SurfaceBakeResponse) => void;
}

let worker: Worker | null = null;
let nextId = 1;
let busy = false;
const jobs: BakeJob[] = [];
let active: BakeJob | null = null;
// Focus rebuilds re-request every body in the system; the cache turns
// those into instant hits instead of re-baking whole worlds.
const cache = new Map<string, SurfaceBakeResponse>();
const CACHE_LIMIT = 24;

function pump(): void {
  if (busy || jobs.length === 0 || !worker) return;
  busy = true;
  active = jobs.shift()!;
  worker.postMessage(active.request);
}

/**
 * One shared background baker for distant solid-planet appearances.
 * Jobs run one at a time; prominent bodies (the focused body, a moon's
 * parent) jump the queue. Resolves never in worker-less environments
 * (tests).
 */
export function requestSurfaceBake(
  seedHex: string,
  physical: Characterization,
  size: number,
  priority = false,
): Promise<SurfaceBakeResponse> {
  if (typeof Worker === 'undefined') return new Promise(() => {});
  const key = `${seedHex}:${size}`;
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  if (!worker) {
    worker = new Worker(new URL('../../workers/surfaceBakeWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<SurfaceBakeResponse>) => {
      const job = active;
      active = null;
      busy = false;
      if (job) {
        const jobKey = `${job.request.seedHex}:${job.request.size}`;
        cache.set(jobKey, event.data);
        if (cache.size > CACHE_LIMIT) {
          cache.delete(cache.keys().next().value!);
        }
        job.resolve(event.data);
      }
      pump();
    };
  }
  const request: SurfaceBakeRequest = { id: nextId++, seedHex, physical, size };
  return new Promise((resolve) => {
    const job = { request, resolve };
    if (priority) jobs.unshift(job);
    else jobs.push(job);
    pump();
  });
}
