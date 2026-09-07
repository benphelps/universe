import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EclipseResult } from './eclipseFinder';
import { searchEclipses, type EclipseSearchReply } from './eclipseSearch';
import type { StarSystem } from '../universe/system/types';

class FakeWorker {
  static last: FakeWorker;
  onmessage?: (event: MessageEvent<EclipseSearchReply>) => void;
  onerror?: (event: { message: string }) => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.last = this;
  }
  reply(data: EclipseSearchReply) {
    this.onmessage?.({ data } as MessageEvent<EclipseSearchReply>);
  }
}
afterEach(() => vi.unstubAllGlobals());
describe('eclipse search worker lifecycle', () => {
  it('forwards filters, progress and the shortlist so far, then releases the worker on completion', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const progress = vi.fn();
    const partial = vi.fn();
    const pending = searchEclipses({} as StarSystem, [], 12, progress, undefined, 'sibling-moon', partial);
    const worker = FakeWorker.last;
    expect(worker.postMessage).toHaveBeenCalledWith({
      current: {},
      neighbors: [],
      startDays: 12,
      filter: 'sibling-moon',
    });
    const report = { checked: 1, total: 2, distancePc: 3 };
    worker.reply({ progress: report });
    expect(progress).toHaveBeenCalledWith(report);
    const found = [{ seedHex: 'a' } as EclipseResult];
    worker.reply({ results: found, done: false });
    expect(partial).toHaveBeenCalledWith(found);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.reply({ results: [], done: true });
    await expect(pending).resolves.toEqual([]);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('terminates calculation immediately on cancellation', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const controller = new AbortController();
    const pending = searchEclipses({} as StarSystem, [], 0, undefined, controller.signal);
    controller.abort();
    await expect(pending).resolves.toEqual([]);
    expect(FakeWorker.last.terminate).toHaveBeenCalledOnce();
  });
  it('reports worker failures and releases resources', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const pending = searchEclipses({} as StarSystem, [], 0);
    FakeWorker.last.reply({ error: 'test failure' });
    await expect(pending).rejects.toThrow('test failure');
    expect(FakeWorker.last.terminate).toHaveBeenCalledOnce();
  });
});
