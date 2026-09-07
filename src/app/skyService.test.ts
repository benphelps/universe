import { expect, it, vi } from 'vitest';
import { cancelSkyBuilds, getSkyField } from './skyService';
import { generationSchedulerLoad } from './generationScheduler';
import { HOME_POSITION } from '../universe/galaxy/density';

it('cancels queued permits but keeps running surveys counted until worker completion', () => {
  let worker: { onmessage?: (event: { data: unknown }) => void };
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void;
    postMessage = vi.fn();
    constructor() { worker = this; }
  }
  vi.stubGlobal('Worker', FakeWorker);
  const capacity = generationSchedulerLoad().capacity;
  try {
    void getSkyField('9876', HOME_POSITION);
    for (let id = 1; id <= capacity + 1; id++) {
      worker!.onmessage!({ data: { type: 'generation-acquire', requestId: id, priority: 'sky-preview' } });
    }
    expect(generationSchedulerLoad()).toMatchObject({ active: capacity, queued: 1 });
    cancelSkyBuilds();
    expect(generationSchedulerLoad()).toMatchObject({ active: capacity, queued: 0 });
    for (let id = 1; id <= capacity + 1; id++) {
      worker!.onmessage!({ data: { type: 'generation-release', requestId: id } });
    }
    expect(generationSchedulerLoad()).toMatchObject({ active: 0, queued: 0 });
  } finally {
    for (let id = 1; id <= capacity + 1; id++) {
      worker!.onmessage!({ data: { type: 'generation-release', requestId: id } });
    }
    vi.unstubAllGlobals();
  }
});
