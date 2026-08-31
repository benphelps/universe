import type { Characterization } from '../../universe/planet/types';
import {
  scheduleGeneration,
  type GenerationPriority,
} from '../../app/generationScheduler';
import type {
  SurfaceBakeRequest,
  SurfaceBakeResponse,
} from '../../workers/surfaceBakeWorker';

interface BakeJob {
  request: SurfaceBakeRequest;
  resolve: (result: SurfaceBakeResponse) => void;
  priority: GenerationPriority;
}

interface Baker {
  worker: Worker;
  active: BakeJob | null;
  release: (() => void) | null;
}

/**
 * How many bakers to run. A whole system's worth of worlds arrives at
 * once and each is an independent field build and raster with nothing
 * to say to the others, so they are as parallel as work gets — one
 * baker meant a system populated its surfaces in series and the last
 * planet waited on seven ahead of it. The same shape the sky sweep and
 * the terrain streamer use: a few cores, never all of them, because
 * those two are often running at the same time.
 */
const POOL_SIZE = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 2));

let pool: Baker[] | null = null;
let nextId = 1;
const jobs: BakeJob[] = [];
let scheduledDispatch: (() => void) | null = null;
let scheduledPriority: GenerationPriority | null = null;

// Focus rebuilds re-request every body in the system; the cache turns
// those into instant hits instead of re-baking whole worlds. Budgeted
// in bytes rather than entries because a cube face grows with the
// square of its size — counting bakes would have meant one budget at
// 128 and sixteen times the memory at 512.
const cache = new Map<string, SurfaceBakeResponse>();
const CACHE_BYTES = 24 * 6 * 128 * 128 * 4;
let cachedBytes = 0;

// Requests that are already out. Without this a body asked for twice
// before the first answer lands is baked twice, which one baker made
// unlikely and a pool makes ordinary.
const inFlight = new Map<string, Promise<SurfaceBakeResponse>>();

function bytesOf(response: SurfaceBakeResponse): number {
  return 6 * response.size * response.size * 4;
}

/** Worlds still waiting on (or holding) a baker. */
export function bakeQueueDepth(): number {
  return jobs.length + (pool?.filter((baker) => baker.active !== null).length ?? 0);
}

function pump(): void {
  if (!pool || jobs.length === 0 || !pool.some((baker) => baker.active === null)) return;
  const priority = jobs[0].priority;
  if (scheduledDispatch) {
    if (scheduledPriority === priority) return;
    scheduledDispatch();
    scheduledDispatch = null;
  }
  scheduledPriority = priority;
  let started = false;
  const cancel = scheduleGeneration(priority, (release) => {
    started = true;
    scheduledDispatch = null;
    scheduledPriority = null;
    const baker = pool?.find((candidate) => candidate.active === null);
    const job = jobs.shift();
    if (!baker || !job) {
      release();
      pump();
      return;
    }
    baker.active = job;
    baker.release = release;
    baker.worker.postMessage(job.request);
    // Fill another idle baker if the global budget has room.
    pump();
  });
  if (!started) scheduledDispatch = cancel;
}

function startPool(): Baker[] {
  const bakers: Baker[] = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const worker = new Worker(new URL('../../workers/surfaceBakeWorker.ts', import.meta.url), {
      type: 'module',
    });
    const baker: Baker = { worker, active: null, release: null };
    worker.onmessage = (event: MessageEvent<SurfaceBakeResponse>) => {
      const job = baker.active;
      baker.active = null;
      const release = baker.release;
      baker.release = null;
      if (job) {
        const key = `${job.request.seedHex}:${job.request.size}`;
        cache.set(key, event.data);
        cachedBytes += bytesOf(event.data);
        while (cachedBytes > CACHE_BYTES && cache.size > 1) {
          const oldest = cache.keys().next().value!;
          cachedBytes -= bytesOf(cache.get(oldest)!);
          cache.delete(oldest);
        }
        inFlight.delete(key);
        job.resolve(event.data);
      }
      release?.();
      pump();
    };
    bakers.push(baker);
  }
  return bakers;
}

/**
 * Background bakers for distant solid-planet appearances. Prominent
 * bodies (the focused body, a moon's parent) jump the queue; the rest
 * are taken in order by whichever baker frees up first. Resolves never
 * in worker-less environments (tests).
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
  const pending = inFlight.get(key);
  if (pending) return pending;

  pool ??= startPool();
  const request: SurfaceBakeRequest = { id: nextId++, seedHex, physical, size };
  const promise = new Promise<SurfaceBakeResponse>((resolve) => {
    const job: BakeJob = {
      request,
      resolve,
      priority: priority ? 'visible-surface' : 'background',
    };
    if (priority) jobs.unshift(job);
    else jobs.push(job);
    pump();
  });
  inFlight.set(key, promise);
  return promise;
}
