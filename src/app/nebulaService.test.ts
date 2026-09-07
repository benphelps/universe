import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MolecularCloud } from '../universe/galaxy/clouds';
import type { NebulaVolumePair } from '../universe/galaxy/nebulaPair';
import type { NebulaBakeResult, NebulaBakeTask } from '../workers/nebulaWorker';
import { subscribeNebulaPair, retainNebulaBakes, pendingNebulaBakes, requestNebulaPair, resetNebulaBakes, shelvedNebulaVolume } from './nebulaService';

class FakeWorker {
  static instances: FakeWorker[] = [];
  tasks: NebulaBakeTask[] = [];
  onmessage?: (event: MessageEvent<NebulaBakeResult>) => void;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(task: NebulaBakeTask) { this.tasks.push(task); }
  terminate() {}
}

afterEach(() => { resetNebulaBakes(); vi.unstubAllGlobals(); FakeWorker.instances = []; });

describe('paired nebula worker delivery', () => {
  it('queues one job, returns both fields together, and caches matching grades', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const cloud = { seed: 987654321n, positionPc: { xPc: 0, yPc: 0, zPc: 0 } } as MolecularCloud;
    const abandoned = vi.fn(), ready = vi.fn();
    expect(requestNebulaPair(cloud, 48, abandoned)).toBeNull();
    expect(requestNebulaPair(cloud, 48, ready)).toBeNull();
    expect(pendingNebulaBakes()).toBe(1);
    const worker = FakeWorker.instances.find(w => w.tasks.length)!;
    expect(worker.tasks).toHaveLength(1);
    expect(ready).not.toHaveBeenCalled();
    const pair = { coarse: { size: 48, data: new Uint8Array(4), compositePhotonLedger: {} },
      fine: { size: 48, data: new Uint8Array(4) } } as NebulaVolumePair;
    worker.onmessage!({ data: { key: worker.tasks[0].key, pair } } as MessageEvent<NebulaBakeResult>);
    expect(ready).toHaveBeenCalledExactlyOnceWith(pair);
    expect(abandoned).not.toHaveBeenCalled();
    expect(pendingNebulaBakes()).toBe(0);
    expect(requestNebulaPair(cloud, 48, ready)).toEqual(pair);
    expect(shelvedNebulaVolume(cloud, [48, 96, 160])).toBe(pair.coarse);
    expect(requestNebulaPair(cloud, 96, ready)).toBeNull();
    expect(pendingNebulaBakes()).toBe(1);
  });
});

it('shares an in-flight resident solve and protects portrait leases from resident re-ranking', () => {
  vi.stubGlobal('Worker', FakeWorker);
  const cloud = { seed: 7654321n, positionPc: { xPc: 0, yPc: 0, zPc: 0 } } as MolecularCloud;
  const resident = vi.fn(), portrait = vi.fn(), cancelled = vi.fn();
  requestNebulaPair(cloud, 48, resident);
  const worker = FakeWorker.instances.find(w => w.tasks.length)!;
  const task = worker.tasks[0];
  subscribeNebulaPair(task, portrait);
  const cancel = subscribeNebulaPair(task, cancelled);
  cancel(); retainNebulaBakes(new Set());
  expect(pendingNebulaBakes()).toBe(1);
  expect(worker.tasks).toHaveLength(1);
  const pair = { coarse: { size: 48, data: new Uint8Array(4) }, fine: null } as NebulaVolumePair;
  worker.onmessage!({ data: { key: task.key, pair } } as MessageEvent<NebulaBakeResult>);
  expect(portrait).toHaveBeenCalledExactlyOnceWith(pair);
  expect(resident).not.toHaveBeenCalled();
  expect(cancelled).not.toHaveBeenCalled();
  const cached = vi.fn(); subscribeNebulaPair(task, cached);
  expect(cached).toHaveBeenCalledExactlyOnceWith(pair);
  expect(worker.tasks).toHaveLength(1);
});

it('settles every portrait lease on reset, including a shared failed result', () => {
  vi.stubGlobal('Worker', FakeWorker);
  const task = { key: 'lease-test', galaxy: '1', seedHex: '2', size: 48, positionPc: { xPc: 0, yPc: 0, zPc: 0 } };
  const first = vi.fn(), second = vi.fn();
  subscribeNebulaPair(task, first); subscribeNebulaPair(task, second);
  resetNebulaBakes(); resetNebulaBakes();
  expect(first).toHaveBeenCalledExactlyOnceWith(null);
  expect(second).toHaveBeenCalledExactlyOnceWith(null);
});
