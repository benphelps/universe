import { seedToHex } from '../core/rng/hash';
import { galaxySeed } from '../universe/galaxy/galaxySeed';
import type { MolecularCloud } from '../universe/galaxy/clouds';
import type { NebulaVolumeBake } from '../universe/galaxy/nebulaVolume';
import type { NebulaBakeResult, NebulaBakeTask } from '../workers/nebulaWorker';

/**
 * Nebula volumes, baked off the frame thread. Camera-led work: what is
 * worth baking changes as you travel, so a request can be abandoned
 * before it lands and the answer for a cloud nobody is looking at any
 * more is simply dropped.
 */
/** A few workers rather than one: an arrival wants half a dozen
 *  volumes and each bake is seconds of field evaluation, so the pool
 *  is what keeps the later residents from queueing behind the first.
 *  Small, because the sky and terrain workers share the same cores —
 *  and the real fix is the GPU bake the plan's ledger carries. */
const POOL_SIZE = 3;
let workers: Worker[] = [];
let nextWorker = 0;
/** Requests in flight, so the same volume is never asked for twice. */
const queued = new Set<string>();
/** Who is still interested in each one. */
const waiting = new Map<string, (bake: NebulaVolumeBake) => void>();
const cache = new Map<string, NebulaVolumeBake>();

/**
 * Drop every bake the old locale was still waiting on, workers and all.
 *
 * A worker takes one message at a time and cannot be asked to leave a
 * bake early, so a travel that merely stopped listening would leave
 * the new locale's volumes queued behind half a minute of answers for
 * a sky nobody is under any more — arriving at a nebula and staring at
 * nothing while the old system's bakes drain. Killing the pool is the
 * cancellation; what already landed stays cached.
 */
export function resetNebulaBakes(): void {
  for (const worker of workers) worker.terminate();
  workers = [];
  queued.clear();
  waiting.clear();
}

/** How many volumes are still queued at the pool — what the
 *  generation readout shows while a nebula is being built. */
export function pendingNebulaBakes(): number {
  return queued.size;
}

function onBake(event: MessageEvent<NebulaBakeResult>): void {
  const answer = waiting.get(event.data.key);
  waiting.delete(event.data.key);
  queued.delete(event.data.key);
  if (!event.data.bake) return;
  cache.set(event.data.key, event.data.bake);
  // Room for a full residency of volumes at both scales, plus a few
  // recently-left clouds the camera may swing back to.
  if (cache.size > 12) cache.delete(cache.keys().next().value as string);
  // A bake the camera has moved on from is still worth keeping — it
  // is the answer for a cloud that may come back into view — but only
  // the request that is still waiting hears about it.
  answer?.(event.data.bake);
}

function nextInPool(): Worker {
  if (workers.length === 0) {
    for (let i = 0; i < POOL_SIZE; i++) {
      const worker = new Worker(new URL('../workers/nebulaWorker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = onBake;
      workers.push(worker);
    }
  }
  nextWorker = (nextWorker + 1) % workers.length;
  return workers[nextWorker];
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
  // Coming back to a cloud whose bake is still in flight has to leave
  // someone listening for it. Registering the new caller and returning
  // is right; dropping it left the answer arriving to nobody and the
  // volume missing until something else forced a rebuild.
  waiting.set(key, onReady);
  if (queued.has(key)) return null;
  queued.add(key);
  const task: NebulaBakeTask = {
    galaxy: seedToHex(galaxySeed()),
    positionPc: cloud.positionPc,
    seedHex: seedToHex(cloud.seed),
    key,
    size,
    boxPc,
  };
  nextInPool().postMessage(task);
  return null;
}
