import type { NebulaBakeTask } from './nebulaWorker';
import type { NebulaVolumePair } from '../universe/galaxy/nebulaPair';

export interface SkyPairRequest { type: 'sky-pair-request'; requestId: number; task: NebulaBakeTask }
export interface SkyPairResult { type: 'sky-pair-result'; requestId: number; pair: NebulaVolumePair | null }
export interface SkyPairCancel { type: 'sky-pair-cancel'; requestIds: number[] }

/** A coordinator holds no CPU permit while the shared pool solves gas. */
export class SkyPairRequests {
  private nextId = 1;
  private readonly pending = new Map<number, (pair: NebulaVolumePair | null) => void>();
  constructor(private readonly post: (message: SkyPairRequest | SkyPairCancel) => void) {}
  request(task: NebulaBakeTask): Promise<NebulaVolumePair | null> {
    const requestId = this.nextId++;
    return new Promise(resolve => {
      this.pending.set(requestId, resolve);
      this.post({ type: 'sky-pair-request', requestId, task });
    });
  }
  receive(result: SkyPairResult): void {
    const resolve = this.pending.get(result.requestId);
    this.pending.delete(result.requestId);
    resolve?.(result.pair);
  }
  cancel(): void {
    const requestIds = [...this.pending.keys()];
    const answers = [...this.pending.values()];
    this.pending.clear();
    if (requestIds.length) this.post({ type: 'sky-pair-cancel', requestIds });
    for (const answer of answers) answer(null);
  }
}

export function pairTransfers(pair: NebulaVolumePair | null): ArrayBuffer[] {
  return pair ? [pair.coarse, pair.fine].flatMap(bake => bake ? [bake.data.buffer, bake.occupancy.buffer,
    ...(bake.continuum ? [bake.continuum.data.buffer] : [])] : []) as ArrayBuffer[] : [];
}
