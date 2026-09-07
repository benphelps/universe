import type { NebulaBakeResult, NebulaBakeTask } from '../workers/nebulaWorker';
import { scheduleGeneration } from './generationScheduler';
import { nebulaAuditEnabled, recordNebulaBake } from './nebulaBakeAudit';

interface Slot {
  worker: Worker | null;
  task: NebulaBakeTask | null;
  cancel: (() => void) | null;
  active: boolean;
}

/** Reserve at most one job per worker, under the shared CPU budget.
 * A worker's private message FIFO must never hide a long bake queue. */
export class NebulaBakePool {
  private slots: Slot[] = [];
  private queue: NebulaBakeTask[] = [];
  private generation = 0;
  private workingBytes = 0;

  constructor(
    private readonly capacity: number,
    private readonly onResult: (result: NebulaBakeResult) => void,
    private readonly schedule = scheduleGeneration,
    private readonly workingBudget = Infinity,
  ) {}

  get reservedBytes(): number { return this.workingBytes; }

  private bytes(task: NebulaBakeTask): number {
    // Older/unpriced callers serialize under a finite budget.
    return task.workingBytes ?? (Number.isFinite(this.workingBudget) ? this.workingBudget : 0);
  }

  request(task: NebulaBakeTask): void {
    const bytes = this.bytes(task);
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > this.workingBudget) {
      if (nebulaAuditEnabled) recordNebulaBake({ event: 'rejected', key: task.key, size: task.size, workingBytes: bytes });
      this.onResult({ key: task.key, pair: null });
      return;
    }
    if (nebulaAuditEnabled) recordNebulaBake({ event: 'queued', key: task.key, size: task.size });
    this.queue.push(task);
    this.pump();
  }

  /** Withdraw obsolete work before it starts. Running jobs finish into
   * the shelf, so cancelling a view never releases a still-busy CPU. */
  retainSeeds(seeds: ReadonlySet<string>): string[] {
    return this.retain(task => seeds.has(task.seedHex));
  }

  retainKeys(keys: ReadonlySet<string>): string[] {
    return this.retain(task => keys.has(task.key));
  }

  private retain(wanted: (task: NebulaBakeTask) => boolean): string[] {
    const cancelled = this.queue.filter(task => !wanted(task)).map(task => task.key);
    this.queue = this.queue.filter(wanted);
    for (const slot of this.slots) {
      if (!slot.task || slot.active || wanted(slot.task)) continue;
      cancelled.push(slot.task.key);
      this.workingBytes -= this.bytes(slot.task);
      slot.task = null;
      slot.cancel?.();
      slot.cancel = null;
    }
    this.pump();
    if (nebulaAuditEnabled) for (const key of cancelled) recordNebulaBake({ event: 'cancelled', key });
    return cancelled;
  }

  reset(): void {
    if (nebulaAuditEnabled) recordNebulaBake({ event: 'reset' });
    this.generation++;
    const slots = this.slots;
    this.slots = [];
    this.queue = [];
    // All workers stop before any permit can start another queued job.
    for (const slot of slots) slot.worker?.terminate();
    this.workingBytes = 0;
    for (const slot of slots) slot.cancel?.();
  }

  private pump(): void {
    while (this.queue.length) {
      // A large refinement must not block a small first arrival/portrait
      // that fits. CPU permits are acquired only after memory admission.
      const next = this.queue.findIndex(task => this.workingBytes + this.bytes(task) <= this.workingBudget);
      if (next < 0) return;
      let slot = this.slots.find(candidate => !candidate.task);
      if (!slot && this.slots.length < this.capacity) {
        slot = { worker: null, task: null, cancel: null, active: false };
        this.slots.push(slot);
      }
      if (!slot) return;
      const reserved = slot;
      const task = this.queue.splice(next, 1)[0];
      this.workingBytes += this.bytes(task);
      const generation = this.generation;
      reserved.task = task;
      reserved.active = false;
      const cancel = this.schedule('background', release => {
        if (generation !== this.generation || reserved.task !== task) { release(); return; }
        reserved.active = true;
        if (nebulaAuditEnabled) recordNebulaBake({ event: 'started', key: task.key, size: task.size, slot: this.slots.indexOf(reserved),
          workingBytes: this.bytes(task), reservedBytes: this.workingBytes, workingBudget: this.workingBudget });
        let finished = false;
        const finish = (result: NebulaBakeResult, failed = false) => {
          if (finished || generation !== this.generation) return;
          finished = true;
          if (failed) { reserved.worker?.terminate(); reserved.worker = null; }
          this.workingBytes -= this.bytes(task);
          reserved.task = null;
          reserved.cancel = null;
          reserved.active = false;
          if (nebulaAuditEnabled) recordNebulaBake({ event: 'finished', key: task.key, size: task.size,
            slot: this.slots.indexOf(reserved), fine: !!result.pair?.fine, metrics: result.metrics });
          try { this.onResult(result); }
          finally { release(); this.pump(); }
        };
        try {
          reserved.worker ??= new Worker(new URL('../workers/nebulaWorker.ts', import.meta.url), { type: 'module' });
          reserved.worker.onmessage = (event: MessageEvent<NebulaBakeResult>) => {
            if (event.data.key === task.key) finish(event.data);
          };
          reserved.worker.onerror = reserved.worker.onmessageerror = () => finish({ key: task.key, pair: null }, true);
          reserved.worker.postMessage(nebulaAuditEnabled ? { ...task, audit: true } : task);
        } catch {
          finish({ key: task.key, pair: null }, true);
        }
      });
      // A synchronous creation/post failure may already have reused
      // this slot. Do not overwrite its next job's cancellation handle.
      if (reserved.task === task) reserved.cancel = cancel;
      else cancel();
    }
  }
}
