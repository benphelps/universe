import { afterEach, expect, it, vi } from 'vitest';
import { requestNuclearClusterStars } from './nuclearCluster';
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  terminate = vi.fn(); postMessage = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); FakeWorker.instances = []; });
it('terminates after delivery and ignores later events', () => {
  vi.stubGlobal('Worker', FakeWorker);
  const ready = vi.fn(), cancel = requestNuclearClusterStars(ready), worker = FakeWorker.instances[0];
  expect(worker.postMessage.mock.calls[0][0].galaxy).toMatch(/^[0-9a-f]+$/);
  worker.onmessage!({data: 'survey'}); worker.onerror!(); cancel();
  worker.onmessage!({data: 'stale'});
  expect(ready).toHaveBeenCalledExactlyOnceWith('survey');
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it('cancels generation and rejects a late completion without restarting', () => {
  vi.stubGlobal('Worker', FakeWorker);
  const ready = vi.fn(), cancel = requestNuclearClusterStars(ready), worker = FakeWorker.instances[0];
  cancel(); cancel(); worker.onmessage!({data: 'stale'}); worker.onerror!();
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(FakeWorker.instances).toHaveLength(1); expect(ready).not.toHaveBeenCalled();
});
it('retries once and rejects stale events from the terminated attempt', () => {
  vi.stubGlobal('Worker', FakeWorker);
  const ready = vi.fn(); requestNuclearClusterStars(ready);
  const first = FakeWorker.instances[0]; first.onerror!();
  const retry = FakeWorker.instances[1]; first.onmessage!({data: 'stale'}); first.onerror!();
  expect(retry.terminate).not.toHaveBeenCalled(); expect(ready).not.toHaveBeenCalled();
  retry.onmessage!({data: 'current'});
  expect(ready).toHaveBeenCalledExactlyOnceWith('current');
  expect(FakeWorker.instances).toHaveLength(2);
});
it('bounds repeated errors and handles unavailable workers', () => {
  vi.stubGlobal('Worker', FakeWorker);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  requestNuclearClusterStars(vi.fn()); FakeWorker.instances[0].onerror!(); FakeWorker.instances[1].onmessageerror!();
  FakeWorker.instances[1].onerror!();
  expect(warning).toHaveBeenCalledOnce(); expect(FakeWorker.instances).toHaveLength(2);
  vi.stubGlobal('Worker', undefined); expect(() => requestNuclearClusterStars(vi.fn())()).not.toThrow();
});
