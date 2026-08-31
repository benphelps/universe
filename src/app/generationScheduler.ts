export type GenerationPriority =
  | 'visible-terrain'
  | 'visible-surface'
  | 'sky-preview'
  | 'background';

export interface GenerationAcquireMessage {
  type: 'generation-acquire';
  requestId: number;
  priority: GenerationPriority;
}

export interface GenerationGrantMessage {
  type: 'generation-grant';
  requestId: number;
}

export interface GenerationReleaseMessage {
  type: 'generation-release';
  requestId: number;
}

type Release = () => void;
type Start = (release: Release) => void;

interface ScheduledTask {
  priority: GenerationPriority;
  sequence: number;
  start: Start;
  state: 'queued' | 'active' | 'done';
  release: Release;
}

const PRIORITY: Record<GenerationPriority, number> = {
  'visible-terrain': 0,
  'visible-surface': 1,
  'sky-preview': 2,
  background: 3,
};

function defaultCapacity(): number {
  const cores = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4;
  // Heavy generators need room for the renderer and browser. The old
  // independent pools could run thirteen jobs at once; six is enough
  // to fill a modern CPU without recreating that contention.
  return Math.min(6, Math.max(1, cores - 2));
}

/**
 * Global permits for CPU-heavy generation jobs. Worker implementations
 * stay specialized, but no pool can independently consume the machine.
 * Running jobs are not preempted; the highest-priority queued job owns
 * the next released slot.
 */
export class GenerationScheduler {
  private readonly queue: ScheduledTask[] = [];
  private sequence = 0;
  private active = 0;
  private draining = false;

  constructor(readonly capacity = defaultCapacity()) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('Generation scheduler capacity must be a positive integer');
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  /**
   * Queue a job and return its cancellation handle. Canceling an active
   * job releases its permit, so callers must stop its worker first.
   */
  schedule(priority: GenerationPriority, start: Start): () => void {
    const task: ScheduledTask = {
      priority,
      sequence: this.sequence++,
      start,
      state: 'queued',
      release: () => {
        if (task.state !== 'active') return;
        task.state = 'done';
        this.active--;
        this.drain();
      },
    };
    this.queue.push(task);
    this.drain();
    return () => {
      if (task.state === 'queued') {
        task.state = 'done';
        const index = this.queue.indexOf(task);
        if (index >= 0) this.queue.splice(index, 1);
      } else {
        task.release();
      }
    };
  }

  private drain(): void {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.active < this.capacity && this.queue.length > 0) {
        this.queue.sort(
          (a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || a.sequence - b.sequence,
        );
        const task = this.queue.shift()!;
        if (task.state !== 'queued') continue;
        task.state = 'active';
        this.active++;
        try {
          task.start(task.release);
        } catch (error) {
          task.release();
          throw error;
        }
      }
    } finally {
      this.draining = false;
    }
  }
}

const scheduler = new GenerationScheduler();

export function scheduleGeneration(priority: GenerationPriority, start: Start): () => void {
  return scheduler.schedule(priority, start);
}

export function generationSchedulerLoad(): { active: number; queued: number; capacity: number } {
  return {
    active: scheduler.activeCount,
    queued: scheduler.queuedCount,
    capacity: scheduler.capacity,
  };
}
