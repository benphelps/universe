import { seedFromHex } from '../core/rng/hash';
import { setGalaxySeed } from '../universe/galaxy/galaxySeed';
import { galacticLandmarks } from '../universe/galaxy/regions';

/** Enumerates the galaxy's landmark catalog off the frame loop —
 *  universal per galaxy, so it runs exactly once per session. */
self.onmessage = (event: MessageEvent<{ galaxy: string }>) => {
  setGalaxySeed(seedFromHex(event.data.galaxy));
  (self as unknown as Worker).postMessage(galacticLandmarks());
};
