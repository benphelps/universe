import { deriveSeed, seedFromHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import type { SurfaceParams } from './params';

type Rgb = [number, number, number];

/** Species per biosphere world — the scatter flags index into these. */
export const TREE_SPECIES_COUNT = 2;

/**
 * One tree species: the numeric recipe a renderer grows geometry from.
 * Pigments derive from the world's own land palette — which already
 * carries the star's spectrum — darkened toward canopy tones; form
 * parameters are seeded per species per world, so a world's forests
 * are its own and identical on every visit.
 */
export interface TreeSpecies {
  /** Trunk height, meters, before canopy. */
  trunkHM: number;
  /** Canopy radius as a fraction of trunk height. */
  canopySpread: number;
  /** Vertical squash: 1 round broadleaf, ~2.2 spired conifer. */
  canopyTaper: number;
  /** Foliage blobs around the crown. */
  blobs: number;
  barkColor: Rgb;
  canopyColor: Rgb;
}

export function deriveTreeSpecies(params: SurfaceParams): TreeSpecies[] {
  const species: TreeSpecies[] = [];
  const base = params.palette.landA;
  for (let i = 0; i < TREE_SPECIES_COUNT; i++) {
    const rng = new Rng(deriveSeed(seedFromHex(params.seedHex), 'flora', i));
    const conifer = rng.bool(0.45);
    const tone = rng.range(0.5, 0.85);
    species.push({
      trunkHM: conifer ? rng.range(6, 12) : rng.range(4, 8),
      canopySpread: conifer ? rng.range(0.25, 0.4) : rng.range(0.45, 0.75),
      canopyTaper: conifer ? rng.range(1.8, 2.6) : rng.range(0.85, 1.15),
      blobs: conifer ? 1 : 2 + rng.int(3),
      barkColor: [0.16 * rng.range(0.8, 1.3), 0.115 * rng.range(0.8, 1.2), 0.08],
      canopyColor: [
        base[0] * tone * rng.range(0.55, 0.9),
        base[1] * tone * rng.range(0.9, 1.1),
        base[2] * tone * rng.range(0.5, 0.85),
      ],
    });
  }
  return species;
}
