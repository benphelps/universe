import { scheduleGeneration } from '../app/generationScheduler';
import { seasonalCycleBytes, seasonalSupport, type SeasonalClimateInput, type SeasonalResult } from '../universe/planet/seasonalClimate';

/** In-memory physical-input cache. No seed-only aliasing, persistent schema
 * or unbounded history. Visual seasonal fields share the same byte budget. */
export class SeasonalClimateCache {
  private readonly entries = new Map<string, SeasonalResult>();
  private bytes = 0;
  constructor(private readonly maxBytes = 1024 * 1024, private readonly maxEntries = 4) {}
  get retainedBytes(): number { return this.bytes; }
  get size(): number { return this.entries.size; }

  request(input: SeasonalClimateInput, ready: (result: SeasonalResult) => void): () => void {
    const reason = seasonalSupport(input);
    if (reason) { ready({status:'unavailable',reason}); return () => {}; }
    const key = JSON.stringify(input), cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key); this.entries.set(key,cached); ready(cached); return () => {};
    }
    let worker: Worker | null = null, stopped = false;
    const cancelPermit = scheduleGeneration('visible-surface', release => {
      const stopWorker = () => { worker?.terminate(); worker = null; };
      const finish = (result: SeasonalResult) => {
        if (stopped) return;
        stopped = true; stopWorker(); release();
        if (!(result.status === 'unavailable' && result.reason === 'worker-failed')) this.retain(key,result);
        ready(result);
      };
      try {
        worker = new Worker(new URL('./seasonalClimateWorker.ts',import.meta.url),{type:'module'});
        worker.onmessage = (event: MessageEvent<SeasonalResult>) => finish(event.data);
        worker.onerror = worker.onmessageerror = () => finish({status:'unavailable',reason:'worker-failed'});
        worker.postMessage(input);
      } catch { finish({status:'unavailable',reason:'worker-failed'}); }
    });
    return () => {
      stopped = true;
      // Stop CPU work before releasing the shared generation permit.
      worker?.terminate(); worker = null; cancelPermit();
    };
  }

  private retain(key: string, result: SeasonalResult): void {
    const bytes = result.status === 'ready' ? seasonalCycleBytes(result.cycle) : 0;
    if (bytes > this.maxBytes || this.maxEntries < 1) return;
    const old = this.entries.get(key);
    if (old) { this.bytes -= old.status === 'ready' ? seasonalCycleBytes(old.cycle) : 0; this.entries.delete(key); }
    this.entries.set(key,result); this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value!;
      const removed = this.entries.get(oldest)!;
      this.bytes -= removed.status === 'ready' ? seasonalCycleBytes(removed.cycle) : 0;
      this.entries.delete(oldest);
    }
  }
}

export const seasonalClimateCache = new SeasonalClimateCache();
