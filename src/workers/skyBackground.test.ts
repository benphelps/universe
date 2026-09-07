import { afterEach, expect, it, vi } from 'vitest';
import { GenerationScheduler } from '../app/generationScheduler';
import { SkyBackgroundBuilder } from './skyBackground';
import { HOME_POSITION } from '../universe/galaxy/density';
import { SkyPairRequests } from './skyPairRequests';
import type { NebulaVolumePair } from '../universe/galaxy/nebulaPair';
import type { BackgroundTask } from './skyBackgroundWorker';
import { NEBULA_TILE, NEBULA_ATLAS_COLS, NEBULA_ATLAS_ROWS, type SkyBackground, type NebulaCandidate } from '../universe/galaxy/skyfield';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onerror?: () => void;
  onmessage?: (event: { data: unknown }) => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}
afterEach(() => { vi.unstubAllGlobals(); FakeWorker.instances = []; });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function harness() {
  vi.stubGlobal('Worker', FakeWorker);
  const scheduler = new GenerationScheduler(1);
  const permits = { acquire: () => new Promise<() => void>(resolve => scheduler.schedule('background', resolve)) };
  const post = vi.fn(), pairs = new SkyPairRequests(post);
  const builder = new SkyBackgroundBuilder(permits, pairs);
  return { scheduler, pairs, post, builder };
}
function base(count: number) {
  const background = { nebulae: Array.from({ length: count }, (_, tile) => ({ seed: BigInt(tile + 1), tile })),
    nebulaAtlas: new Float32Array(NEBULA_ATLAS_COLS * NEBULA_ATLAS_ROWS * NEBULA_TILE ** 2 * 4) } as SkyBackground;
  const jobs = background.nebulae.map(patch => ({ cloud: { seed: patch.seed, positionPc: HOME_POSITION } })) as NebulaCandidate[];
  return { background, jobs };
}

it('releases the base permit before bounded parallel solves, then streams out-of-order tiles on a single CPU', async () => {
  const { scheduler, pairs, post, builder } = harness();
  const preview = vi.fn(), portrait = vi.fn(), progress = vi.fn();
  const pending = builder.start('1', HOME_POSITION, '2', () => false, progress, preview, portrait);
  await flush();
  const worker = FakeWorker.instances[0];
  const task = worker.postMessage.mock.calls[0][0] as BackgroundTask;
  worker.onmessage!({ data: { id: task.id + 99, progress: 1, stage: 'stale' } });
  expect(progress).not.toHaveBeenCalled();
  worker.onmessage!({ data: { id: task.id, base: base(5) } });
  await flush();
  expect(preview).toHaveBeenCalledOnce();
  expect(scheduler.activeCount).toBe(0);
  expect(post.mock.calls).toHaveLength(3);
  // Complete each selected object in two grades. Reverse the first
  // requests to prove completion order never chooses an atlas slot.
  const handled = new Set<number>();
  const order: number[] = [];
  while (portrait.mock.calls.length < 5) {
    const request = post.mock.calls.map(([r]) => r).reverse().find(r => r.type === 'sky-pair-request' && !handled.has(r.requestId));
    expect(request).toBeDefined(); handled.add(request.requestId);
    pairs.receive({ type: 'sky-pair-result', requestId: request.requestId, pair: { coarse: { size: request.task.size, data: new Uint8Array(4), occupancy: new Uint8Array(1) }, fine: null } as NebulaVolumePair });
    await flush();
    const command = worker.postMessage.mock.lastCall![0] as Extract<BackgroundTask, { kind: 'portrait' }>;
    expect(command.kind).toBe('portrait');
    expect(scheduler.activeCount).toBe(1);
    const update = command.size === 48 ? { patch: { seed: BigInt(command.tile + 1), tile: command.tile }, pixels: new Float32Array(NEBULA_TILE ** 2 * 4).fill(command.tile + 1) } : undefined;
    worker.onmessage!({ data: { id: command.id, measured: { lines: 1, scattered: 1 }, sizes: [...command.sizes, command.size], portrait: update } });
    if (update) order.push(command.tile);
    await flush();
    expect(scheduler.activeCount).toBe(0);
  }
  const built = await pending;
  expect(order[0]).toBe(2);
  expect(built?.nebulae.map(p => p.tile)).toEqual([0, 1, 2, 3, 4]);
  expect(portrait).toHaveBeenCalledTimes(5);
  expect(scheduler.queuedCount).toBe(0);
});

it('cancels pending pairs and rejects late tiles without retaining permits', async () => {
  const { scheduler, pairs, post, builder } = harness();
  const pending = builder.start('1', HOME_POSITION, '2', () => false);
  await flush();
  const worker = FakeWorker.instances[0];
  worker.onmessage!({ data: { id: worker.postMessage.mock.calls[0][0].id, base: base(2) } });
  await flush();
  builder.cancel(); builder.cancel();
  expect(await pending).toBeNull();
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(post.mock.lastCall![0]).toMatchObject({ type: 'sky-pair-cancel', requestIds: [1, 2] });
  pairs.receive({ type: 'sky-pair-result', requestId: 1, pair: null });
  expect(scheduler.activeCount).toBe(0);
});

it('worker errors settle and terminate before releasing their permit', async () => {
  const { scheduler, builder } = harness();
  const pending = builder.start('1', HOME_POSITION, '2', () => false);
  await flush();
  const worker = FakeWorker.instances[0];
  worker.terminate.mockImplementation(() => expect(scheduler.activeCount).toBe(1));
  worker.onerror!();
  expect(await pending).toBeNull();
  expect(scheduler.activeCount).toBe(0);
});

it('a late permit cannot start a cancelled background', async () => {
  const { scheduler, builder } = harness();
  let release!: () => void;
  scheduler.schedule('background', r => { release = r; });
  const pending = builder.start('1', HOME_POSITION, '2', () => false);
  await flush();
  builder.cancel(); release();
  expect(await pending).toBeNull();
  expect(FakeWorker.instances).toHaveLength(0);
  expect(scheduler.activeCount).toBe(0);
});


it('retries failures through the shared pool and never asks the map worker to solve gas', async () => {
  const { scheduler, pairs, post, builder } = harness();
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const pending = builder.start('1', HOME_POSITION, '2', () => false);
  await flush();
  const worker = FakeWorker.instances[0];
  worker.onmessage!({ data: { id: worker.postMessage.mock.calls[0][0].id, base: base(1) } });
  await flush();
  for (let i = 0; i < 2; i++) {
    const request = post.mock.calls.filter(([r]) => r.type === 'sky-pair-request').at(-1)![0];
    pairs.receive({ type: 'sky-pair-result', requestId: request.requestId, pair: null });
    await flush();
  }
  expect(await pending).toBeNull();
  expect(post.mock.calls.filter(([r]) => r.type === 'sky-pair-request')).toHaveLength(2);
  expect(worker.postMessage).toHaveBeenCalledOnce();
  expect(scheduler.activeCount).toBe(0);
  expect(worker.terminate).toHaveBeenCalledOnce();
  warning.mockRestore();
});
