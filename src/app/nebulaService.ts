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

/**
 * Drop every bake the old locale was still waiting on, worker and all.
 *
 * The worker takes one message at a time and cannot be asked to leave
 * a bake early, so a travel that merely stopped listening would leave
 * the new locale's volumes queued behind half a minute of answers for
 * a sky nobody is under any more — arriving at a nebula and staring at
 * nothing while the old system's bakes drain. Killing the worker is
 * the cancellation; what already landed stays cached.
 */
export function resetNebulaBakes(): void {
  worker?.terminate();
  worker = null;
  queued.clear();
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
  // Coming back to a cloud whose bake is still in flight has to leave
  // someone listening for it. Registering the new caller and returning
  // is right; dropping it left the answer arriving to nobody and the
  // volume missing until something else forced a rebuild.
  waiting.set(key, onReady);
  if (queued.has(key)) return null;
  queued.add(key);
  const active = ensureWorker();
  active.onmessage = (event: MessageEvent<NebulaBakeResult>) => {
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
