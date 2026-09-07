import { seedToHex } from '../core/rng/hash';
import { galaxySeed } from '../universe/galaxy/galaxySeed';
import type { ResidencyQuery, ResidencySelection } from '../universe/galaxy/residencySelection';
import type { ResidencyResult } from '../workers/residencyWorker';
import { scheduleGeneration } from './generationScheduler';

interface Request { id: number; query: ResidencyQuery; deliver: (result: ResidencySelection) => void }
/** One worker, one running request and one replaceable destination. A cancelled
 * running request keeps its CPU permit until the worker acknowledges stopping. */
export class NebulaResidencyService {
  private worker: Worker | null = null;
  private sequence = 0;
  private desired: Request | null = null;
  private active: { id: number; release: () => void } | null = null;
  private waiting: (() => void) | null = null;
  private disposed = false;
  constructor(private readonly createWorker = () => new Worker(new URL('../workers/residencyWorker.ts', import.meta.url), { type: 'module' })) {}

  get pending(): boolean { return !!(this.desired || this.active || this.waiting); }

  request(query: ResidencyQuery, deliver: Request['deliver']): void {
    if (this.disposed) return;
    this.desired = { id: ++this.sequence, query, deliver };
    if (this.active) this.worker!.postMessage({ type: 'cancel', id: this.active.id });
    this.pump();
  }

  cancel(): void {
    this.desired = null;
    this.waiting?.(); this.waiting = null;
    if (this.active) this.worker!.postMessage({ type: 'cancel', id: this.active.id });
  }

  dispose(): void {
    this.disposed = true;
    this.desired = null;
    this.waiting?.(); this.waiting = null;
    this.worker?.terminate(); this.worker = null;
    this.active?.release(); this.active = null;
  }

  private pump(): void {
    if (this.active || this.waiting || !this.desired || this.disposed) return;
    // schedule() may start synchronously; don't retain a cancellation handle
    // for an already granted request after the callback clears waiting.
    let granted = false;
    const cancel = scheduleGeneration('sky-preview', release => {
      granted = true; this.waiting = null;
      const request = this.desired;
      if (!request || this.disposed) { release(); return; }
      try {
        if (!this.worker) {
          const worker = this.worker = this.createWorker();
          worker.onmessage = (event: MessageEvent<ResidencyResult>) => this.finished(worker, event.data);
          worker.onerror = () => this.failed(worker);
          worker.onmessageerror = () => this.failed(worker);
        }
        this.active = { id: request.id, release };
        this.worker.postMessage({ type: 'select', id: request.id, galaxy: seedToHex(galaxySeed()), query: request.query });
      } catch (error) {
        if (this.worker) this.failed(this.worker);
        else { this.desired = null; this.active = null; release(); }
        console.warn('cloud residency selection failed:', error);
      }
    });
    if (!granted) this.waiting = cancel;
  }

  private finished(worker: Worker, message: ResidencyResult): void {
    if (this.worker !== worker || this.active?.id !== message.id) return;
    const release = this.active.release;
    this.active = null;
    const request = this.desired?.id === message.id ? this.desired : null;
    if (request) this.desired = null;
    release();
    if (message.error) console.warn('cloud residency selection failed:', message.error);
    if (request && message.result) request.deliver(message.result);
    this.pump();
  }

  private failed(worker: Worker): void {
    if (worker !== this.worker) return;
    worker.terminate(); this.worker = null;
    this.desired = null;
    const active = this.active; this.active = null;
    active?.release();
    console.warn('cloud residency worker stopped; retaining the previous visible clouds');
  }
}
