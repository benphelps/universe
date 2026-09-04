import type { GenerationPriority } from '../app/generationScheduler';
import {
  surveyTask,
  type SurveyResult,
  type SurveyTask,
} from '../universe/galaxy/skyBuildPlan';

type Acquire = (priority: GenerationPriority) => Promise<() => void>;
type OnResult = (result: SurveyResult) => void;

interface Queued {
  task: SurveyTask;
  onResult: OnResult;
  abandoned: boolean;
}

/**
 * The workers that survey cells, fed one job at a time under a permit
 * from the shared scheduler. Results come home by task id, so a job
 * that outlives the build which asked for it is still filed. Where
 * workers cannot be made, jobs run here, one after another.
 */
export class SkySweepPool {
  readonly size: number;
  private readonly idle: Worker[] = [];
  private readonly queue: Queued[] = [];
  private readonly inflight = new Map<number, Queued>();
  private inlineBusy = false;

  constructor(size: number, private readonly acquire: Acquire) {
    const workers: Worker[] = [];
    try {
      for (let i = 0; i < size; i++) {
        workers.push(
          new Worker(new URL('./skySweepWorker.ts', import.meta.url), { type: 'module' }),
        );
      }
    } catch {
      for (const worker of workers) worker.terminate();
      workers.length = 0;
    }
    this.size = Math.max(1, workers.length);
    for (const worker of workers) {
      worker.onmessage = (event: MessageEvent<SurveyResult>) => {
        this.settle(event.data);
        this.idle.push(worker);
        this.pump();
      };
      this.idle.push(worker);
    }
  }

  run(task: SurveyTask, onResult: OnResult): void {
    this.queue.push({ task, onResult, abandoned: false });
    this.pump();
  }

  /** Drop every job not yet running. Running jobs finish and are
   *  filed as usual. */
  abandon(): void {
    for (const queued of this.queue) queued.abandoned = true;
    this.queue.length = 0;
    for (const queued of this.inflight.values()) queued.abandoned = true;
  }

  private settle(result: SurveyResult): void {
    const queued = this.inflight.get(result.taskId);
    if (!queued) return;
    this.inflight.delete(result.taskId);
    queued.onResult(result);
  }

  private pump(): void {
    if (this.idle.length === 0 && !this.inlineBusy && this.size === 1 && this.queue.length) {
      this.pumpInline();
      return;
    }
    while (this.idle.length && this.queue.length) {
      const worker = this.idle.pop()!;
      const queued = this.queue.shift()!;
      this.inflight.set(queued.task.taskId, queued);
      void this.acquire('sky-preview').then((release) => {
        if (queued.abandoned) {
          release();
          this.inflight.delete(queued.task.taskId);
          this.idle.push(worker);
          this.pump();
          return;
        }
        // The permit is held for as long as the worker is busy; the
        // job is the same either way, so abandoning it now is only a
        // matter of who the result goes to.
        queued.abandoned = false;
        const { onResult } = queued;
        queued.onResult = (result) => {
          release();
          onResult(result);
        };
        worker.postMessage(queued.task, [queued.task.cells.buffer]);
      });
    }
  }

  private pumpInline(): void {
    const queued = this.queue.shift()!;
    this.inlineBusy = true;
    void this.acquire('sky-preview').then((release) => {
      try {
        if (!queued.abandoned) queued.onResult(surveyTask(queued.task));
      } finally {
        release();
        this.inlineBusy = false;
        this.pump();
      }
    });
  }
}
