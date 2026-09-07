import { seedFromHex } from '../core/rng/hash';
import { setGalaxySeed } from '../universe/galaxy/galaxySeed';
import { buildNuclearClusterStars } from '../universe/galaxy/clusterStars';

self.onmessage = (event: MessageEvent<{ galaxy: string }>) => {
  setGalaxySeed(seedFromHex(event.data.galaxy));
  const stars = buildNuclearClusterStars();
  const transfers = [stars.positionsPc, stars.colors, stars.luminosities, stars.opticalLuminosities,
    stars.initialMasses, stars.agesGyr, stars.epochIndices, stars.column.data].map(array => array.buffer);
  (self as unknown as Worker).postMessage(stars, transfers);
};
