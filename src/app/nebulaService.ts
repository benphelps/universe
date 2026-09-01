import { seedToHex } from '../core/rng/hash';
import { galaxySeed } from '../universe/galaxy/galaxySeed';
import type { Nebula } from '../universe/galaxy/nebula';
import type { NebulaVolumeBake } from '../universe/galaxy/nebulaVolume';
import type { NebulaBakeResult, NebulaBakeTask } from '../workers/nebulaWorker';

/**
 * Nebula volumes, baked one at a time off the frame thread. Camera-led
 * work: what is worth baking changes as you travel, so a request can be
 * abandoned before it lands and the answer for a cloud nobody is
 * looking at any more is simply dropped.
 */
let worker: Worker | null = null;
let pending: string | null = null;
const cache = new Map<string, NebulaVolumeBake>();

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
  nebula: Nebula,
  size: number,
  boxPc: number | undefined,
  onReady: (bake: NebulaVolumeBake) => void,
): NebulaVolumeBake | null {
  // A cloud can be wanted at more than one scale — its whole body from
  // outside, its ionized bubble from within — so the scale is part of
  // what is being asked for, not just the cloud.
  const key = `${seedToHex(nebula.cloud.seed)}@${boxPc ? boxPc.toFixed(1) : 'bubble'}`;
  const cached = cache.get(key);
  if (cached) return cached;
  if (pending === key) return null;

  pending = key;
  const active = ensureWorker();
  active.onmessage = (event: MessageEvent<NebulaBakeResult>) => {
    if (event.data.key !== pending) return;
    pending = null;
    if (!event.data.bake) return;
    cache.set(event.data.key, event.data.bake);
    if (cache.size > 6) cache.delete(cache.keys().next().value as string);
    onReady(event.data.bake);
  };
  const task: NebulaBakeTask = {
    galaxy: seedToHex(galaxySeed()),
    positionPc: nebula.cloud.positionPc,
    seedHex: seedToHex(nebula.cloud.seed),
    key,
    size,
    boxPc,
  };
  active.postMessage(task);
  return null;
}
