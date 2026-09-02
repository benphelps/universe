import { seedToHex } from '../core/rng/hash';
import type { GalacticPosition } from '../universe/galaxy/density';
import { galaxySeed } from '../universe/galaxy/galaxySeed';
import type { LocaleInventory } from './localeInventory';
import type { LocaleInventoryTask } from '../workers/localeInventoryWorker';

/**
 * One worker charts each arrival's surroundings; only the latest
 * request is still wanted when an answer lands, so travel that
 * outruns the chart simply drops the stale one.
 */
let worker: Worker | null = null;
let token = 0;
let waiting: ((inventory: LocaleInventory) => void) | null = null;

export function requestLocaleInventory(
  localePc: GalacticPosition,
  onReady: (inventory: LocaleInventory) => void,
): void {
  if (!worker) {
    worker = new Worker(new URL('../workers/localeInventoryWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<{ token: number; inventory: LocaleInventory }>) => {
      if (event.data.token !== token) return;
      waiting?.(event.data.inventory);
      waiting = null;
    };
  }
  token++;
  waiting = onReady;
  const task: LocaleInventoryTask = { galaxy: seedToHex(galaxySeed()), localePc, token };
  worker.postMessage(task);
}
