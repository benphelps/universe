import { seedToHex } from '../core/rng/hash';
import { galaxySeed } from '../universe/galaxy/galaxySeed';
import type { ClusterStars } from '../universe/galaxy/clusterStars';

/** One short-lived worker per visible nucleus, no growing seed cache.
 * Disposal cancels construction as well as ignoring a stale reply. */
export function requestNuclearClusterStars(ready: (stars: ClusterStars) => void): () => void {
  let worker: Worker | null = null, stopped = false, attempts = 0;
  const stopWorker = () => { worker?.terminate(); worker = null; };
  const start = () => {
    if (stopped || typeof Worker === 'undefined') return;
    try {
      const active = new Worker(new URL('./nuclearClusterWorker.ts', import.meta.url), { type: 'module' });
      worker = active;
      active.onmessage = (event: MessageEvent<ClusterStars>) => {
        if (stopped || worker !== active) return;
        stopWorker(); stopped = true; ready(event.data);
      };
      active.onerror = active.onmessageerror = () => {
        if (stopped || worker !== active) return;
        stopWorker();
        if (!stopped && ++attempts < 2) start();
        else if (!stopped) { stopped = true; console.warn('Nuclear star survey failed after retry'); }
      };
      active.postMessage({ galaxy: seedToHex(galaxySeed()) });
    } catch {
      stopWorker();
      if (!stopped) console.warn('Nuclear star survey worker is unavailable');
    }
  };
  start();
  return () => { stopped = true; stopWorker(); };
}
