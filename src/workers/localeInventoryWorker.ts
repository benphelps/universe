import { seedFromHex } from '../core/rng/hash';
import type { GalacticPosition } from '../universe/galaxy/density';
import { setGalaxySeed } from '../universe/galaxy/galaxySeed';
import { chartLocale } from '../app/localeInventory';

export interface LocaleInventoryTask {
  galaxy: string;
  localePc: GalacticPosition;
  token: number;
}

/** Charts a locale's surroundings off the frame loop: a few hundred
 *  clouds classified and a province's members found, per arrival. */
self.onmessage = (event: MessageEvent<LocaleInventoryTask>) => {
  setGalaxySeed(seedFromHex(event.data.galaxy));
  (self as unknown as Worker).postMessage({
    token: event.data.token,
    inventory: chartLocale(event.data.localePc),
  });
};
