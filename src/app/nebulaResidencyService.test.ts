import { beforeEach, expect, it, vi } from 'vitest';
import { NebulaResidencyService } from './nebulaResidencyService';
import type { ResidencyQuery, ResidencySelection } from '../universe/galaxy/residencySelection';
const scheduler = vi.hoisted(() => ({ defer: false, starts: [] as Array<(release: () => void) => void>,
  releases: [] as Array<ReturnType<typeof vi.fn>>, cancels: [] as Array<ReturnType<typeof vi.fn>> }));
vi.mock('./generationScheduler', () => ({ scheduleGeneration: (_priority: string, start: (release: () => void) => void) => {
  const release = vi.fn(), cancel = vi.fn();
  scheduler.releases.push(release); scheduler.cancels.push(cancel);
  if (scheduler.defer) scheduler.starts.push(start); else start(release);
  return cancel;
} }));
beforeEach(() => { scheduler.defer = false; scheduler.starts = []; scheduler.releases = []; scheduler.cancels = []; });
const query = { position: { xPc: 0, yPc: 0, zPc: 0 }, reachPc: 2000, minimumAngular: .02,
  count: 12, pedestal: 1, focused: null } satisfies ResidencyQuery;
function setup() {
  const worker = { onmessage: null as ((e: unknown) => void) | null,
    onerror: null as (() => void) | null, onmessageerror: null, postMessage: vi.fn(), terminate: vi.fn() };
  const service = new NebulaResidencyService(() => worker as unknown as Worker);
  const finish = (id: number) => worker.onmessage!({ data: { id, result: { chosen: [] } as unknown as ResidencySelection } });
  return { worker, service, finish };
}

it('coalesces destinations, holds the running permit until cancellation acknowledgment, and ignores stale results', () => {
  const { service, worker, finish } = setup(); const old = vi.fn(), latest = vi.fn();
  service.request(query, old);
  service.request({ ...query, position: { xPc: 60, yPc: 0, zPc: 0 } }, vi.fn());
  service.request({ ...query, position: { xPc: 120, yPc: 0, zPc: 0 } }, latest);
  expect(worker.postMessage.mock.calls.filter(([m]) => m.type === 'select')).toHaveLength(1);
  expect(scheduler.releases[0]).not.toHaveBeenCalled();
  finish(1);
  expect(old).not.toHaveBeenCalled(); expect(scheduler.releases[0]).toHaveBeenCalledOnce();
  expect(worker.postMessage.mock.lastCall![0]).toMatchObject({ type: 'select', id: 3 });
  finish(1); expect(scheduler.releases[1]).not.toHaveBeenCalled();
  finish(3); expect(latest).toHaveBeenCalledOnce(); expect(service.pending).toBe(false);
});

it('withdraws a queued request and cancels an active travel without delivering its old selection', () => {
  scheduler.defer = true;
  const { service, worker, finish } = setup(); const deliver = vi.fn();
  service.request(query, deliver); service.cancel();
  expect(scheduler.cancels[0]).toHaveBeenCalledOnce(); expect(worker.postMessage).not.toHaveBeenCalled();
  expect(service.pending).toBe(false);
  scheduler.defer = false; service.request(query, deliver); service.cancel();
  expect(service.pending).toBe(true); expect(scheduler.releases[1]).not.toHaveBeenCalled();
  finish(2); expect(deliver).not.toHaveBeenCalled(); expect(service.pending).toBe(false);
});

it('terminates before releasing on disposal or worker failure, then rejects late messages', () => {
  const { service, worker, finish } = setup(); const deliver = vi.fn();
  service.request(query, deliver); service.dispose(); service.dispose(); finish(1);
  expect(worker.terminate).toHaveBeenCalledOnce(); expect(scheduler.releases[0]).toHaveBeenCalledOnce();
  expect(worker.terminate.mock.invocationCallOrder[0]).toBeLessThan(scheduler.releases[0].mock.invocationCallOrder[0]);
  expect(deliver).not.toHaveBeenCalled(); expect(service.pending).toBe(false);
  const failed = setup(); failed.service.request(query, deliver);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  failed.worker.onerror!(); failed.finish(1);
  expect(failed.worker.terminate).toHaveBeenCalledOnce(); expect(scheduler.releases[1]).toHaveBeenCalledOnce();
  expect(failed.service.pending).toBe(false); warning.mockRestore();
});
