import { describe, expect, it, vi } from 'vitest';
import { GpuFrameTimer } from './gpuFrameTimer';

function fixture() {
  const queries: Array<{ ready: boolean; ns: number }> = [];
  const gl = {
    QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2,
    getExtension: vi.fn(() => ({ TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 })),
    getParameter: vi.fn(() => false),
    getQueryParameter: vi.fn((q: typeof queries[number], key: number) => key === 1 ? q.ready : q.ns),
    createQuery: vi.fn(() => { const q = { ready: false, ns: (queries.length + 1) * 1e6 }; queries.push(q); return q; }),
    beginQuery: vi.fn(), endQuery: vi.fn(), deleteQuery: vi.fn(),
  };
  const timer = new GpuFrameTimer(gl as unknown as WebGL2RenderingContext);
  return { gl, timer, queries };
}

describe('GPU frame timer', () => {
  it('keeps the newest completed result and balances each query scope', () => {
    const { gl, timer, queries } = fixture();
    for (let i = 0; i < 3; i++) { timer.begin(); timer.begin(); timer.end(); timer.end(); }
    expect(gl.beginQuery).toHaveBeenCalledTimes(3);
    expect(gl.endQuery).toHaveBeenCalledTimes(3);
    queries.forEach(q => q.ready = true);
    timer.begin();
    expect(timer.elapsedMs).toBe(3);
    expect(gl.deleteQuery).toHaveBeenCalledTimes(3);
    timer.dispose();
    expect(gl.endQuery).toHaveBeenCalledTimes(4);
    expect(gl.deleteQuery).toHaveBeenCalledTimes(4);
  });

  it('bounds pending work without ending a query that did not start', () => {
    const { gl, timer } = fixture();
    for (let i = 0; i < 100; i++) { timer.begin(); timer.end(); }
    expect(gl.createQuery).toHaveBeenCalledTimes(8);
    expect(gl.endQuery).toHaveBeenCalledTimes(8);
    expect(timer.elapsedMs).toBeNull();
    timer.dispose();
    expect(gl.deleteQuery).toHaveBeenCalledTimes(8);
  });

  it('discards all disjoint results and resumes cleanly', () => {
    const { gl, timer, queries } = fixture();
    timer.begin(); timer.end(); queries[0].ready = true;
    timer.begin(); timer.end();
    expect(timer.elapsedMs).toBe(1);
    gl.getParameter.mockReturnValue(true);
    timer.begin(); timer.end();
    expect(timer.elapsedMs).toBeNull();
    expect(gl.deleteQuery).toHaveBeenCalledTimes(2);
    expect(gl.endQuery).toHaveBeenCalledTimes(2);
    gl.getParameter.mockReturnValue(false);
    timer.begin(); timer.end();
    expect(gl.createQuery).toHaveBeenCalledTimes(3);
    timer.dispose();
  });

  it('leaves timing unavailable without an extension or query allocation', () => {
    const { gl } = fixture();
    gl.getExtension.mockReturnValue(null as never);
    const absent = new GpuFrameTimer(gl as unknown as WebGL2RenderingContext);
    absent.begin(); absent.end(); absent.dispose();
    expect(absent.elapsedMs).toBeNull();
    expect(gl.createQuery).not.toHaveBeenCalled();
    const f = fixture();
    f.gl.createQuery.mockReturnValue(null as never);
    f.timer.begin(); f.timer.end();
    expect(f.gl.endQuery).not.toHaveBeenCalled();
  });
});
