import { galacticLandmarks } from '../universe/galaxy/regions';

/** Enumerates the galaxy's landmark catalog off the frame loop —
 *  universal, so it runs exactly once per session. */
self.onmessage = () => {
  (self as unknown as Worker).postMessage(galacticLandmarks());
};
