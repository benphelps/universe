import { afterEach, expect, it, vi } from 'vitest';
import { GenerationScheduler } from './generationScheduler';
import { NebulaBakePool } from './nebulaBakePool';
import type { NebulaBakeTask } from '../workers/nebulaWorker';

class FakeWorker {
  static instances: FakeWorker[] = [];
  tasks: NebulaBakeTask[] = [];
  onmessage?: (event: { data: { key: string; pair: null } }) => void;
  onerror?: () => void;
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  postMessage(task: NebulaBakeTask) { this.tasks.push(task); }
  finish() { this.onmessage?.({ data: { key: this.tasks.at(-1)!.key, pair: null } }); }
}
afterEach(() => { vi.unstubAllGlobals(); FakeWorker.instances = []; });
const task = (key: string) => ({ key, seedHex: key } as NebulaBakeTask);

it('drops obsolete waiting bakes without freeing running work or blocking wanted jobs', () => {
  vi.stubGlobal('Worker', FakeWorker);
  const scheduler = new GenerationScheduler(1), ready = vi.fn();
  const pool = new NebulaBakePool(2, ready, scheduler.schedule.bind(scheduler));
  for (const key of ['running', 'obsolete-reserved', 'obsolete-queued', 'wanted']) pool.request(task(key));
  expect(pool.retainSeeds(new Set(['wanted'])).sort()).toEqual(['obsolete-queued', 'obsolete-reserved']);
  expect(scheduler.activeCount).toBe(1);
  expect(scheduler.queuedCount).toBe(1);
  FakeWorker.instances[0].finish();
  expect(ready).toHaveBeenCalledExactlyOnceWith({ key: 'running', pair: null });
  expect(FakeWorker.instances.at(-1)!.tasks.at(-1)!.key).toBe('wanted');
  pool.reset();
  expect(scheduler.activeCount).toBe(0);
});

it('honours the global budget and lets visible work go ahead of nebula bakes', () => {
  vi.stubGlobal('Worker', FakeWorker);
  const scheduler = new GenerationScheduler(1);
  const ready = vi.fn(), preview = vi.fn();
  const pool = new NebulaBakePool(3, ready, scheduler.schedule.bind(scheduler));
  for (let i = 0; i < 6; i++) pool.request(task(String(i)));
  expect(FakeWorker.instances).toHaveLength(1);
  scheduler.schedule('sky-preview', release => { preview(); release(); });
  FakeWorker.instances[0].finish();
  expect(preview).toHaveBeenCalledOnce();
  expect(ready).toHaveBeenCalledOnce();
  expect(scheduler.activeCount).toBe(1);
  pool.reset();
  expect(scheduler.activeCount).toBe(0);
  expect(scheduler.queuedCount).toBe(0);
});

it('dispatches the next bake to the first free worker without private FIFOs', () => {
  vi.stubGlobal('Worker', FakeWorker);
  const scheduler = new GenerationScheduler(6);
  const pool = new NebulaBakePool(3, vi.fn(), scheduler.schedule.bind(scheduler));
  for (let i = 0; i < 9; i++) pool.request(task(String(i)));
  expect(FakeWorker.instances.map(w => w.tasks.length)).toEqual([1, 1, 1]);
  FakeWorker.instances[1].finish();
  expect(FakeWorker.instances.map(w => w.tasks.length)).toEqual([1, 2, 1]);
  expect(scheduler.activeCount).toBe(3);
  pool.reset();
  expect(scheduler.activeCount).toBe(0);
});

it('reset stops workers before releasing permits and ignores late results', () => {
  vi.stubGlobal('Worker', FakeWorker);
  const scheduler = new GenerationScheduler(1), ready = vi.fn();
  const pool = new NebulaBakePool(3, ready, scheduler.schedule.bind(scheduler));
  pool.request(task('old')); pool.request(task('queued'));
  const worker = FakeWorker.instances[0], late = worker.onmessage!;
  scheduler.schedule('sky-preview', release => {
    expect(worker.terminate).toHaveBeenCalledOnce(); release();
  });
  pool.reset();
  late({ data: { key: 'old', pair: null } });
  expect(ready).not.toHaveBeenCalled();
  expect(scheduler.activeCount).toBe(0);
  expect(scheduler.queuedCount).toBe(0);
  pool.request(task('new')); FakeWorker.instances.at(-1)!.finish();
  expect(ready).toHaveBeenCalledExactlyOnceWith({ key: 'new', pair: null });
  pool.reset();
});

it('worker failure releases capacity and replaces the failed worker', () => {
  vi.stubGlobal('Worker', FakeWorker);
  const scheduler = new GenerationScheduler(1), ready = vi.fn();
  const pool = new NebulaBakePool(1, ready, scheduler.schedule.bind(scheduler));
  pool.request(task('bad')); pool.request(task('next'));
  FakeWorker.instances[0].onerror!();
  expect(ready).toHaveBeenCalledExactlyOnceWith({ key: 'bad', pair: null });
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  expect(FakeWorker.instances[1].tasks[0].key).toBe('next');
  pool.reset();
  expect(scheduler.activeCount).toBe(0);
});

it('admits by aggregate bytes and runs smaller jobs past a waiting large upgrade', () => {
  vi.stubGlobal('Worker', FakeWorker);
  const scheduler = new GenerationScheduler(6);
  const pool = new NebulaBakePool(3, vi.fn(), scheduler.schedule.bind(scheduler), 100);
  const priced = (key: string, workingBytes: number) => ({ ...task(key), workingBytes });
  pool.request(priced('first', 60)); pool.request(priced('large', 70)); pool.request(priced('small', 40));
  expect(FakeWorker.instances.map(w => w.tasks[0].key)).toEqual(['first', 'small']);
  expect(pool.reservedBytes).toBe(100);
  FakeWorker.instances[0].finish();
  expect(pool.reservedBytes).toBe(40);
  FakeWorker.instances[1].finish();
  expect(pool.reservedBytes).toBe(70);
  expect(FakeWorker.instances[0].tasks.at(-1)!.key).toBe('large');
  pool.reset(); expect(pool.reservedBytes).toBe(0);
});

it('cancels queued CPU reservations without releasing bytes owned by running workers', () => {
  vi.stubGlobal('Worker', FakeWorker);
  const scheduler = new GenerationScheduler(1), ready = vi.fn();
  const pool = new NebulaBakePool(3, ready, scheduler.schedule.bind(scheduler), 100);
  for (const [key, workingBytes] of [['active', 40], ['reserved', 60], ['waiting', 100]] as const) pool.request({ ...task(key), workingBytes });
  expect(pool.reservedBytes).toBe(100);
  pool.retainSeeds(new Set(['waiting']));
  expect(pool.reservedBytes).toBe(40);
  expect(scheduler.activeCount).toBe(1);
  FakeWorker.instances[0].onerror!();
  expect(pool.reservedBytes).toBe(100);
  const worker = FakeWorker.instances.at(-1)!;
  worker.terminate.mockImplementation(() => expect(pool.reservedBytes).toBe(100));
  pool.reset(); expect(pool.reservedBytes).toBe(0);
  expect(scheduler.activeCount).toBe(0);
});

it('rejects an impossible reservation without stranding subscribers or acquiring a CPU', () => {
  vi.stubGlobal('Worker', FakeWorker);
  const scheduler = new GenerationScheduler(1), ready = vi.fn();
  const pool = new NebulaBakePool(3, ready, scheduler.schedule.bind(scheduler), 100);
  pool.request({ ...task('impossible'), workingBytes: 101 });
  expect(ready).toHaveBeenCalledExactlyOnceWith({ key: 'impossible', pair: null });
  expect(scheduler.activeCount).toBe(0); expect(pool.reservedBytes).toBe(0);
  expect(FakeWorker.instances).toHaveLength(0);
});
