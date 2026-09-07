import { seedToHex } from '../core/rng/hash';
import type { GalacticPosition } from '../universe/galaxy/density';
import { applySkyPortrait, type SkyBackground, type SkyProgress, type SkyPortraitUpdate } from '../universe/galaxy/skyfield';
import type { NebulaPortrait } from '../universe/galaxy/nebulaPortrait';
import type { GenerationPermits } from './generationPermits';
import type { BackgroundResult, BackgroundTask } from './skyBackgroundWorker';
import { pairTransfers, type SkyPairRequests } from './skyPairRequests';
import { nebulaBakeWorkingBytes } from '../universe/galaxy/nebulaBakeMemory';
import { NEBULA_WORKING_BYTES } from '../app/nebulaMemory';

type WorkResult = Exclude<BackgroundResult, { progress: number }>;
type Command = BackgroundTask extends infer T ? T extends BackgroundTask ? Omit<T, 'id'> : never : never;

/** Three portrait lanes bound solved-payload copies as well as work.
 * Each lane retains one grade at a time (at most 96³); completed grids
 * live only in the shared byte-bounded shelf, never a whole-sky cache. */
export class SkyBackgroundBuilder {
  private worker: Worker | null = null;
  private generation = 0;
  private nextId = 1;
  private tail: Promise<unknown> = Promise.resolve();
  private active: { id: number; finish: (result: WorkResult | null) => void; progress?: SkyProgress } | null = null;

  constructor(private readonly permits: Pick<GenerationPermits, 'acquire'>, private readonly pairs: SkyPairRequests) {}

  async start(seedHex: string, viewpoint: GalacticPosition, galaxy: string, stale: () => boolean,
    onProgress?: SkyProgress, onBase?: (background: SkyBackground) => void,
    onPortrait?: (update: SkyPortraitUpdate) => void,
  ): Promise<SkyBackground | null> {
    const generation = this.generation;
    const abandoned = () => stale() || generation !== this.generation;
    const base = await this.run({ kind: 'base', seedHex, viewpoint, galaxy }, abandoned,
      (fraction, stage, step) => onProgress?.(0.1 * fraction, stage, step));
    if (!base || !('base' in base) || abandoned()) return null;
    const { background, jobs } = base.base;
    onBase?.(background);
    let next = 0, completed = 0;
    onProgress?.(0.1, `nebulae 0/${jobs.length}`, 0);
    const lane = async () => {
      while (next < jobs.length && !abandoned()) {
        const tile = next++, candidate = jobs[tile];
        let previous: NebulaPortrait['luminosities'] | undefined, sizes: number[] = [];
        const grades = [32, 48, 64, 96].map(size => ({ size,
          workingBytes: nebulaBakeWorkingBytes(candidate.cloud, candidate.nebula, size) }))
          .filter(grade => grade.workingBytes <= NEBULA_WORKING_BYTES);
        if (!grades.length) { this.cancel(); return; }
        for (const { size, workingBytes } of grades) {
          const cloudSeed = seedToHex(candidate.cloud.seed);
          const task = { galaxy, positionPc: candidate.cloud.positionPc,
            seedHex: cloudSeed, key: `${galaxy}@${cloudSeed}@paired@${size}`, size,
            workingBytes };
          let pair = await this.pairs.request(task);
          if (abandoned()) return;
          // A failed worker/copy gets one retry through the same byte budget.
          // Never hide an unbudgeted physical solve inside the map worker.
          if (!pair) pair = await this.pairs.request(task);
          if (abandoned()) return;
          if (!pair) { console.warn('nebula portrait bake failed:', task.key); this.cancel(); return; }
          const result = await this.run({ kind: 'portrait', galaxy, candidate, tile, size, pair, previous, sizes,
            lastGrade: size === grades.at(-1)!.size }, abandoned);
          if (!result || !('measured' in result) || abandoned()) return;
          if (result.portrait) {
            applySkyPortrait(background, result.portrait);
            onPortrait?.(result.portrait);
            completed++;
            onProgress?.(0.1 + 0.9 * completed / jobs.length, `nebulae ${completed}/${jobs.length}`, completed / jobs.length);
            break;
          }
          previous = result.measured; sizes = result.sizes;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, lane));
    return abandoned() || completed !== jobs.length ? null : background;
  }

  cancel(): void {
    this.generation++;
    this.pairs.cancel();
    // Terminate before releasing the active command's CPU permit.
    this.worker?.terminate(); this.worker = null;
    this.active?.finish(null);
  }

  /** Serialize map work before acquiring a permit. No private worker
   * FIFO and no permit held while waiting for another generator. */
  private run(command: Command, stale: () => boolean, progress?: SkyProgress): Promise<WorkResult | null> {
    const result = this.tail.then(async () => {
      if (stale()) return null;
      const release = await this.permits.acquire('background');
      if (stale()) { release(); return null; }
      const worker = this.ensureWorker();
      if (!worker) { release(); this.cancel(); return null; }
      return new Promise<WorkResult | null>(resolve => {
        const id = this.nextId++;
        this.active = { id, progress, finish: result => {
          this.active = null; release(); resolve(result);
        } };
        try { worker.postMessage({ ...command, id }, command.kind === 'portrait' ? pairTransfers(command.pair) : []); }
        catch { this.cancel(); }
      });
    });
    this.tail = result;
    return result;
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    try { this.worker = new Worker(new URL('./skyBackgroundWorker.ts', import.meta.url), { type: 'module' }); }
    catch { return null; }
    this.worker.onmessage = (event: MessageEvent<BackgroundResult>) => {
      const claim = this.active;
      if (!claim || event.data.id !== claim.id) return;
      if ('progress' in event.data) { claim.progress?.(event.data.progress, event.data.stage, event.data.stageFraction); return; }
      claim.finish(event.data);
    };
    this.worker.onerror = this.worker.onmessageerror = () => this.cancel();
    return this.worker;
  }
}
