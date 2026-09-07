import type { SkyDrawing } from '../render/starfield/skyDrawing';
import { beginLoadingWork, endLoadingWork } from './loadingWorkAudit';
import { recordSkyLoading, recordSkyPortraitOutput } from './skyLoadingAudit';
import { subscribeNebulaPair } from './nebulaService';
import { pairTransfers, type SkyPairRequest, type SkyPairCancel, type SkyPairResult } from '../workers/skyPairRequests';
import { seedToHex } from '../core/rng/hash';
import type { GalacticPosition } from '../universe/galaxy/density';
import { galaxySeed } from '../universe/galaxy/galaxySeed';
import {
  scheduleGeneration,
  type GenerationAcquireMessage,
  type GenerationGrantMessage,
  type GenerationReleaseMessage,
} from './generationScheduler';
import type {
  SkyBackground,
  SkyPortraitUpdate,
  SkyField,
  SkyPreview,
} from '../universe/galaxy/skyfield';
import type { SkyCancelMessage } from '../workers/skyWorker';

/**
 * One shared sky-building worker with a small per-seed cache, so every
 * viewer of the same system reuses the same computed sky.
 */
export interface SkyFieldDelivery { sky: SkyField; drawing: SkyDrawing }
const cache = new Map<string, Promise<SkyFieldDelivery>>();
let worker: Worker | null = null;
const waiting = new Map<string, (delivery: SkyFieldDelivery) => void>();
/** Who wants to draw slabs as they land, per seed. */
const watching = new Map<string, (preview: SkyPreview) => void>();
/** Who wants the gas and glow as soon as it exists, per seed. */
const watchingPortrait = new Map<string, (update: SkyPortraitUpdate) => void>();
const watchingBackground = new Map<string, (background: SkyBackground) => void>();

export interface SkyBuildProgress {
  fraction: number;
  stage: string;
  /** Progress within the stage; −1 when the stage has no measure. */
  stageFraction: number;
}

const progress = new Map<string, SkyBuildProgress>();
interface SkyPermit {
  cancel: (() => void) | null;
  release: (() => void) | null;
}
const skyPermits = new Map<number, SkyPermit>();
const pairLeases = new Map<number, () => void>();

function requestSkyPair(source: Worker, request: SkyPairRequest): void {
  let delivered = false;
  const cancel = subscribeNebulaPair(request.task, pair => {
    delivered = true;
    pairLeases.delete(request.requestId);
    // The shelf and residents keep the original. One bounded copy moves
    // through the coordinator into its portrait worker without more copies.
    const copyStart = beginLoadingWork();
    let copy: typeof pair = null;
    try { copy = pair ? structuredClone(pair) : null; }
    catch { /* The coordinator retries through the shared bake service. */ }
    const result: SkyPairResult = { type: 'sky-pair-result', requestId: request.requestId, pair: copy };
    source.postMessage(result, pairTransfers(copy));
    endLoadingWork('portrait-pair-copy', copyStart);
  });
  if (!delivered) pairLeases.set(request.requestId, cancel);
}

function acquireSkyPermit(source: Worker, request: GenerationAcquireMessage): void {
  const permit: SkyPermit = { cancel: null, release: null };
  skyPermits.set(request.requestId, permit);
  permit.cancel = scheduleGeneration(request.priority, (release) => {
    permit.release = release;
    if (worker !== source) {
      skyPermits.delete(request.requestId);
      release();
      return;
    }
    const grant: GenerationGrantMessage = {
      type: 'generation-grant',
      requestId: request.requestId,
    };
    source.postMessage(grant);
  });
}

function releaseSkyPermit(request: GenerationReleaseMessage): void {
  const permit = skyPermits.get(request.requestId);
  if (!permit) return;
  skyPermits.delete(request.requestId);
  if (permit.release) permit.release();
  else permit.cancel?.();
}

function clearSkyPermits(): void {
  for (const [id, permit] of skyPermits) {
    // Running survey jobs finish into the cell cache after cancellation.
    // They still occupy a CPU until their worker releases the permit.
    if (permit.release) continue;
    permit.cancel?.();
    skyPermits.delete(id);
  }
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/skyWorker.ts', import.meta.url), { type: 'module' });
  const source = worker;
  source.onmessage = (
    event: MessageEvent<{
      seedHex: string;
      sky?: SkyField;
      drawing?: SkyDrawing;
      progress?: number;
      stage?: string;
      stageFraction?: number;
      dirs?: Float32Array;
      background?: SkyBackground;
      portrait?: SkyPortraitUpdate;
      type?: GenerationAcquireMessage['type'] | GenerationReleaseMessage['type'] | SkyPairRequest['type'] | SkyPairCancel['type'];
      requestId?: number;
      priority?: GenerationAcquireMessage['priority'];
    }>,
  ) => {
    if (event.data.type === 'sky-pair-request') {
      requestSkyPair(source, event.data as unknown as SkyPairRequest); return;
    }
    if (event.data.type === 'sky-pair-cancel') {
      for (const id of (event.data as unknown as SkyPairCancel).requestIds) { pairLeases.get(id)?.(); pairLeases.delete(id); }
      return;
    }
    if (event.data.type === 'generation-acquire') {
      acquireSkyPermit(source, event.data as GenerationAcquireMessage);
      return;
    }
    if (event.data.type === 'generation-release') {
      releaseSkyPermit(event.data as GenerationReleaseMessage);
      return;
    }
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
      recordSkyLoading(event.data.seedHex, 'stars');
      watching.get(event.data.seedHex)?.(event.data as unknown as SkyPreview);
      return;
    }
    if (event.data.portrait) {
      recordSkyLoading(event.data.seedHex, 'portrait', event.data.portrait.patch.tile);
      watchingPortrait.get(event.data.seedHex)?.(event.data.portrait);
      return;
    }
    // The gas, dust and glow, which the stars have no say in.
    if (event.data.background) {
      recordSkyLoading(event.data.seedHex, 'base');
      watchingBackground.get(event.data.seedHex)?.(event.data.background);
      return;
    }
    recordSkyLoading(event.data.seedHex, 'complete');
    if (event.data.sky) void recordSkyPortraitOutput(event.data.seedHex, event.data.sky.nebulaAtlas, event.data.sky.nebulae);
    waiting.get(event.data.seedHex)?.({ sky: event.data.sky!, drawing: event.data.drawing! });
    waiting.delete(event.data.seedHex);
    watching.delete(event.data.seedHex);
    watchingBackground.delete(event.data.seedHex);
    watchingPortrait.delete(event.data.seedHex);
    progress.delete(event.data.seedHex);
  };
  return source;
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
 * Diving to a galaxy's centre leaves that system's sky building for a
 * viewpoint nobody is standing at any more, and so does travelling on
 * to the next star: work that will be thrown away when it lands, a
 * progress bar counting toward it, and a queue the next request has
 * to wait behind. The builds are given up, not the worker — the cell
 * surveys it holds are what makes the next nearby arrival fast.
 */
export function cancelSkyBuilds(): void {
  if (!worker) return;
  clearSkyPermits();
  for (const cancel of pairLeases.values()) cancel();
  pairLeases.clear();
  const cancel: SkyCancelMessage = { type: 'sky-cancel' };
  worker.postMessage(cancel);
  watching.clear();
  watchingBackground.clear();
  watchingPortrait.clear();
  // A promise whose build is given up never settles, so it must not be
  // left in the cache for the next caller to await forever.
  for (const seedHex of waiting.keys()) {
    recordSkyLoading(seedHex, 'cancel');
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
  onPortrait?: (update: SkyPortraitUpdate) => void,
): void {
  watching.set(seedHex, onPreview);
  if (onBackground) watchingBackground.set(seedHex, onBackground);
  if (onPortrait) watchingPortrait.set(seedHex, onPortrait);
}

export function getSkyField(seedHex: string, viewpoint: GalacticPosition): Promise<SkyFieldDelivery> {
  const key = `${seedHex}:${viewpoint.xPc.toFixed(4)},${viewpoint.yPc.toFixed(4)},${viewpoint.zPc.toFixed(4)}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = new Promise<SkyFieldDelivery>((resolve) => {
    recordSkyLoading(seedHex, 'start');
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
