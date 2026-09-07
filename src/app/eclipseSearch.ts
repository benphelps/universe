import type { Neighbor } from '../universe/galaxy/neighborhood';
import type { StarSystem } from '../universe/system/types';
import type { EclipseFilter, EclipseResult, EclipseSearchProgress } from './eclipseFinder';

export interface EclipseSearchRequest {
  current: StarSystem;
  neighbors: readonly Neighbor[];
  startDays: number;
  filter: EclipseFilter;
}
export type EclipseSearchReply =
  | { progress: EclipseSearchProgress }
  | { results: EclipseResult[]; done: boolean }
  | { error: string };

/** A neighbourhood-wide conjunction survey belongs off the animation
 * thread. Each search owns its worker, so cancellation also stops Kepler
 * solving; the shortlist so far arrives while it runs. */
export function searchEclipses(
  current: StarSystem,
  neighbors: readonly Neighbor[],
  startDays: number,
  onProgress?: (progress: EclipseSearchProgress) => void,
  signal?: AbortSignal,
  filter: EclipseFilter = 'all',
  onResults?: (results: EclipseResult[]) => void,
): Promise<EclipseResult[]> {
  if (signal?.aborted) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./eclipseSearchWorker.ts', import.meta.url), {
      type: 'module',
    });
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      resolve([]);
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<EclipseSearchReply>) => {
      const reply = event.data;
      if ('progress' in reply) onProgress?.(reply.progress);
      else if ('results' in reply && !reply.done) onResults?.(reply.results);
      else {
        cleanup();
        if ('error' in reply) reject(new Error(reply.error));
        else resolve(reply.results);
      }
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'Eclipse search failed'));
    };
    worker.postMessage({ current, neighbors, startDays, filter } satisfies EclipseSearchRequest);
  });
}
