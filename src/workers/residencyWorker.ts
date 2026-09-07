import { seedFromHex } from '../core/rng/hash';
import { setGalaxySeed } from '../universe/galaxy/galaxySeed';
import { ResidencySelector, type ResidencyQuery, type ResidencySelection } from '../universe/galaxy/residencySelection';

export type ResidencyTask = { type: 'select'; id: number; galaxy: string; query: ResidencyQuery }
  | { type: 'cancel'; id: number };
export interface ResidencyResult { id: number; result: ResidencySelection | null; error?: string }
const selector = new ResidencySelector();
let cancelled = -1;
self.onmessage = async (event: MessageEvent<ResidencyTask>) => {
  const task = event.data;
  if (task.type === 'cancel') { cancelled = task.id; return; }
  try {
    setGalaxySeed(seedFromHex(task.galaxy));
    const result = await selector.select(task.query, () => cancelled === task.id);
    self.postMessage({ id: task.id, result } satisfies ResidencyResult);
  } catch (error) {
    self.postMessage({ id: task.id, result: null, error: String(error) } satisfies ResidencyResult);
  }
};
