import { seedToHex } from '../core/rng/hash';
import { galaxySeed } from '../universe/galaxy/galaxySeed';
import type { MolecularCloud } from '../universe/galaxy/clouds';
import type { NebulaVolumeBake } from '../universe/galaxy/nebulaVolume';
import type { NebulaBakeResult, NebulaBakeTask } from '../workers/nebulaWorker';

/**
 * Nebula volumes, baked one at a time off the frame thread. Camera-led
 * work: what is worth baking changes as you travel, so a request can be
 * abandoned before it lands and the answer for a cloud nobody is
 * looking at any more is simply dropped.
 */
let worker: Worker | null = null;
/** Requests in flight, so the same volume is never asked for twice. */
const queued = new Set<string>();
/** Who is still interested in each one. */
const waiting = new Map<string, (bake: NebulaVolumeBake) => void>();
const cache = new Map<string, NebulaVolumeBake>();

/** Stop caring about volumes nobody is looking at any more. The worker
 *  finishes what it started — a bake is one message, not a loop it can
 *  be asked to leave — but its answer lands in the cache and no stale
 *  install follows it. */
export function abandonPendingVolumes(): void {
  waiting.clear();
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/nebulaWorker.ts', import.meta.url), { type: 'module' });
  return worker;
}

/**
 * The volume for a nebula, if it is already baked; otherwise starts the
 * bake and answers through `onReady` unless something else is asked for
 * first.
 */
export function requestNebulaVolume(
  cloud: MolecularCloud,
  size: number,
  boxPc: number | undefined,
  onReady: (bake: NebulaVolumeBake) => void,
): NebulaVolumeBake | null {
  // A cloud can be wanted at more than one scale — its whole body from
  // outside, its ionized bubble from within — so the scale is part of
  // what is being asked for, not just the cloud.
  const key = `${seedToHex(cloud.seed)}@${boxPc ? boxPc.toFixed(1) : 'bubble'}`;
  const cached = cache.get(key);
  if (cached) return cached;
  if (queued.has(key)) return null;
  queued.add(key);
  const active = ensureWorker();
  waiting.set(key, onReady);
  active.onmessage = (event: MessageEvent<NebulaBakeResult>) => {
    const answer = waiting.get(event.data.key);
    waiting.delete(event.data.key);
    queued.delete(event.data.key);
    if (!event.data.bake) return;
    cache.set(event.data.key, event.data.bake);
    if (cache.size > 8) cache.delete(cache.keys().next().value as string);
    // A bake the camera has moved on from is still worth keeping — it
    // is the answer for a cloud that may come back into view — but only
    // the request that is still waiting hears about it.
    answer?.(event.data.bake);
  };
  const task: NebulaBakeTask = {
    galaxy: seedToHex(galaxySeed()),
    positionPc: cloud.positionPc,
    seedHex: seedToHex(cloud.seed),
    key,
    size,
    boxPc,
  };
  active.postMessage(task);
  return null;
}
