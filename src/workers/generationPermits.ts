import type {
  GenerationAcquireMessage,
  GenerationPriority,
  GenerationReleaseMessage,
} from '../app/generationScheduler';

type Release = () => void;

/**
 * A worker's side of the shared generation scheduler: every CPU-heavy
 * job asks the main thread for a permit before it runs and hands it
 * back after. Requests the main thread has already withdrawn are
 * answered here with a permit that holds nothing, so a job waiting on
 * one is not left waiting forever; a grant that arrives for such a
 * request is handed straight back, so the scheduler's slot is not
 * left held by no one.
 */
export class GenerationPermits {
  private nextRequestId = 1;
  private readonly pending = new Map<number, (release: Release) => void>();

  constructor(
    private readonly post: (message: GenerationAcquireMessage | GenerationReleaseMessage) => void,
  ) {}

  acquire(priority: GenerationPriority): Promise<Release> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve) => {
      this.pending.set(requestId, resolve);
      this.post({ type: 'generation-acquire', requestId, priority });
    });
  }

  grant(requestId: number): void {
    const resolve = this.pending.get(requestId);
    if (!resolve) {
      this.post({ type: 'generation-release', requestId });
      return;
    }
    this.pending.delete(requestId);
    let released = false;
    resolve(() => {
      if (released) return;
      released = true;
      this.post({ type: 'generation-release', requestId });
    });
  }

  /** Answer every request still waiting with an empty permit. */
  abandonPending(): void {
    for (const resolve of this.pending.values()) resolve(() => {});
    this.pending.clear();
  }
}
