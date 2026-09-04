import type { GalacticPosition } from '../universe/galaxy/density';
import type { SkyBackground } from '../universe/galaxy/skyfield';
import type { GenerationPermits } from './generationPermits';
import type { BackgroundResult, BackgroundTask } from './skyBackgroundWorker';

/**
 * The gas, dust and glow of a sky, built on their own thread beside
 * the star survey. It is queued just after the visible-star permits,
 * so spare capacity still runs both side by side without allowing the
 * background to delay the first preview slabs. A bake in progress
 * cannot be interrupted, so a build abandoned mid-bake takes its
 * thread with it rather than making the next build queue behind it.
 */
export class SkyBackgroundBuilder {
  private worker: Worker | null = null;
  private busy = false;
  private readonly waiting = new Map<string, (background: SkyBackground) => void>();

  constructor(private readonly permits: GenerationPermits) {}

  async start(
    seedHex: string,
    viewpoint: GalacticPosition,
    galaxy: string,
    stale: () => boolean,
  ): Promise<SkyBackground | null> {
    const release = await this.permits.acquire('background');
    if (stale()) {
      release();
      return null;
    }
    const worker = this.ensureWorker();
    if (!worker) {
      release();
      return null;
    }
    return new Promise((resolve) => {
      // Results are claimed by seed, not by whoever set the handler
      // last: a single overwritten onmessage is a quiet way for a
      // build to hang forever.
      this.waiting.set(seedHex, (background) => {
        this.busy = false;
        release();
        resolve(background);
      });
      this.busy = true;
      const task: BackgroundTask = { seedHex, viewpoint, galaxy };
      worker.postMessage(task);
    });
  }

  cancel(): void {
    if (!this.busy) return;
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    this.waiting.clear();
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(new URL('./skyBackgroundWorker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      return null;
    }
    this.worker.onmessage = (event: MessageEvent<BackgroundResult>) => {
      const claim = this.waiting.get(event.data.seedHex);
      if (!claim) return;
      this.waiting.delete(event.data.seedHex);
      claim(event.data.background);
    };
    return this.worker;
  }
}
