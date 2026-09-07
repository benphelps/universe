import { seedToHex } from '../core/rng/hash';
import { galaxySeed } from '../universe/galaxy/galaxySeed';
import type { MolecularCloud } from '../universe/galaxy/clouds';
import type { NebulaVolumeBake } from '../universe/galaxy/nebulaVolume';
import type { NebulaVolumePair } from '../universe/galaxy/nebulaPair';
import type { NebulaBakeResult, NebulaBakeTask } from '../workers/nebulaWorker';
import { NebulaShelf } from './nebulaShelf';
import { NebulaBakePool } from './nebulaBakePool';
import { NEBULA_POOL_SIZE, NEBULA_LOOSE_BYTES, NEBULA_WORKING_BYTES } from './nebulaMemory';
import { nebulaBakeMemory } from '../universe/galaxy/nebulaBakeMemory';
import { nebulaFor } from '../universe/galaxy/nebula';

/**
 * Nebula volumes, baked off the frame thread. Camera-led work: what is
 * worth baking changes as you travel, so a request can be abandoned
 * before it lands and the answer for a cloud nobody is looking at any
 * more is simply dropped.
 */
/** A few workers rather than one. GPU gas sampling is followed by a
 *  shared CPU transport solve; where a worker cannot reach a GPU the
 *  gas march takes longer too, and the pool is
 *  what keeps an arrival's later residents from queueing behind the
 *  first. Small, because the sky and terrain workers share the cores. */
const pool = new NebulaBakePool(NEBULA_POOL_SIZE, onBake, undefined, NEBULA_WORKING_BYTES);
/** Requests in flight, so the same volume is never asked for twice. */
const queued = new Set<string>();
/** Who is still interested in each one. */
const waiting = new Map<string, (pair: NebulaVolumePair) => void>();
/** Independent portrait subscribers must survive a resident re-ranking. */
const subscribers = new Map<string, Set<(pair: NebulaVolumePair | null) => void>>();
/** Landed bakes for the clouds the camera may swing back to. Standing
 *  volumes hold theirs; the loose rest are bounded by this much. An
 *  orbit around a complex churns some sixty clouds through residency,
 *  and at the far grade a lit one is seven megabytes. */
const shelf = new NebulaShelf(NEBULA_LOOSE_BYTES);
const keyOf = new WeakMap<NebulaVolumeBake, string>();
let estimates = new WeakMap<MolecularCloud, Map<number, ReturnType<typeof nebulaBakeMemory>>>();

/** A worker selection carries the same exact source/box admission estimates.
 * Its structured-cloned cloud has a fresh identity on every delivery. */
export function rememberNebulaEstimates(cloud: MolecularCloud, values: Record<number, ReturnType<typeof nebulaBakeMemory>>): void {
  estimates.set(cloud, new Map(Object.entries(values).map(([size, value]) => [Number(size), value])));
}

/** Reuse the small source/box plan while a resident is being ranked. */
function estimate(cloud: MolecularCloud, size: number): ReturnType<typeof nebulaBakeMemory> {
  let grades = estimates.get(cloud);
  if (!grades) { grades = new Map(); estimates.set(cloud, grades); }
  let memory = grades.get(size);
  if (memory === undefined) { memory = nebulaBakeMemory(cloud, nebulaFor(cloud), size); grades.set(size, memory); }
  return memory;
}

export function nebulaWorkingBytes(cloud: MolecularCloud, size: number): number { return estimate(cloud, size).workingBytes; }
export function nebulaDomains(cloud: MolecularCloud, size: number): number { return estimate(cloud, size).domains; }

export function pendingNebulaGrade(cloud: MolecularCloud): number {
  const prefix = `${seedToHex(galaxySeed())}@${seedToHex(cloud.seed)}@paired@`;
  let grade = 0;
  for (const key of waiting.keys()) if (key.startsWith(prefix)) grade = Math.max(grade, Number(key.slice(prefix.length)));
  return grade;
}

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
  pool.reset();
  queued.clear();
  waiting.clear();
  estimates = new WeakMap();
  const abandoned = [...subscribers.values()].flatMap(listeners => [...listeners]);
  subscribers.clear();
  for (const answer of abandoned) answer(null);
}

/** How many volumes are still queued at the pool — what the
 *  generation readout shows while a nebula is being built. */
export function pendingNebulaBakes(): number {
  return queued.size;
}

/** Re-ranking or reducing residency should not bake the abandoned queue. */
export function retainNebulaBakes(seeds: ReadonlySet<bigint>): void {
  const wanted = new Set([...seeds].map(seedToHex));
  for (const key of waiting.keys()) if (!wanted.has(key.split('@')[1])) waiting.delete(key);
  pruneUnwanted();
}

function pruneUnwanted(): void {
  const keys = new Set([...waiting.keys(), ...subscribers.keys()]);
  for (const key of pool.retainKeys(keys)) queued.delete(key);
}

function onBake(result: NebulaBakeResult): void {
  const answer = waiting.get(result.key);
  waiting.delete(result.key);
  queued.delete(result.key);
  const listeners = subscribers.get(result.key);
  subscribers.delete(result.key);
  const pair = result.pair;
  if (!pair) { for (const listener of listeners ?? []) listener(null); return; }
  for (const [part, bake] of [['coarse', pair.coarse], ['fine', pair.fine]] as const) {
    if (!bake) continue;
    const key = `${result.key}@${part}`;
    shelf.put(key, bake);
    keyOf.set(bake, key);
  }
  // A bake the camera has moved on from is still worth keeping — it
  // is the answer for a cloud that may come back into view — but only
  // the request that is still waiting hears about it.
  answer?.(pair);
  for (const listener of listeners ?? []) listener(pair);
}

/**
 * The volume for a nebula, if it is already baked; otherwise starts the
 * bake and answers through `onReady` unless something else is asked for
 * first.
 */
/** A cloud can be wanted at more than one scale — its whole body from
 *  outside, its ionized bubble from within — and at more than one
 *  resolution, since a sky-filling volume earns a finer grid. Both are
 *  part of what is being asked for, not just the cloud. */
function volumeKey(cloud: MolecularCloud, size: number): string {
  return `${seedToHex(galaxySeed())}@${seedToHex(cloud.seed)}@paired@${size}`;
}

function cachedPair(key: string): NebulaVolumePair | null {
  const coarse = shelf.get(`${key}@coarse`);
  if (!coarse) return null;
  const fine = shelf.get(`${key}@fine`) ?? null;
  // A coupled coarse grid has a dark hole where its fine partner goes.
  // Never return half a pair, even if the loose shelf evicted one half.
  if (coarse.compositePhotonLedger && !fine) return null;
  return { coarse, fine };
}

/** The finest of these grids the shelf already holds for a cloud, so
 *  a cloud coming back into residency stands straight up at the grade
 *  it left at rather than climbing from the first again. */
export function shelvedNebulaVolume(
  cloud: MolecularCloud,
  sizes: number[],
): NebulaVolumeBake | null {
  for (const size of [...sizes].sort((a, b) => b - a)) {
    const pair = cachedPair(volumeKey(cloud, size));
    if (pair) return pair.coarse;
  }
  return null;
}

/** A volume stands on this bake: keep it. */
export function holdNebulaVolume(bake: NebulaVolumeBake): void {
  const key = keyOf.get(bake);
  if (key) shelf.hold(key);
}

export function releaseNebulaVolume(bake: NebulaVolumeBake): void {
  const key = keyOf.get(bake);
  if (key) shelf.release(key);
}

export function requestNebulaPair(
  cloud: MolecularCloud,
  size: number,
  onReady: (pair: NebulaVolumePair) => void,
): NebulaVolumePair | null {
  const key = volumeKey(cloud, size);
  const cached = cachedPair(key);
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
    workingBytes: nebulaWorkingBytes(cloud, size),
  };
  pool.request(task);
  return null;
}

/** Same physical key/pool/shelf as resident volumes, with an independent
 * cancellation lease. Cache delivery is synchronous; callers must allow it. */
export function subscribeNebulaPair(task: NebulaBakeTask, answer: (pair: NebulaVolumePair | null) => void): () => void {
  const cached = cachedPair(task.key);
  if (cached) { answer(cached); return () => {}; }
  let listeners = subscribers.get(task.key);
  if (!listeners) { listeners = new Set(); subscribers.set(task.key, listeners); }
  listeners.add(answer);
  if (!queued.has(task.key)) { queued.add(task.key); pool.request(task); }
  return () => {
    const current = subscribers.get(task.key);
    if (!current?.delete(answer)) return;
    if (!current.size) subscribers.delete(task.key);
    pruneUnwanted();
  };
}
