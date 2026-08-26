import { deriveSeed } from '../../core/rng/hash';
import type { GalacticPosition } from '../galaxy/density';
import { generatedName, sectorName } from '../galaxy/regions';

/** Landmark threshold (L☉): stars this luminous carry proper names —
 *  visible across hundreds of parsecs, the glints a sky is known by. */
export const PROPER_NAME_LUMINOSITY = 10;

/** Component letters for the members of a multiple system. */
export const COMPONENT_LETTERS = 'BCDEFGH';

/**
 * A star's chartable designation, the way human astronomy layers its
 * names: the luminous few get proper names drawn from the gazetteer's
 * own phonology — one language names the sectors, the nebulae, and the
 * bright stars — while the bulk file into their sector's catalog by
 * number, Gliese-style. Names are designations, not identities: the
 * seed remains the one true id (and a great sector can eventually
 * repeat a catalog number, as surveys do), so the name needs only to
 * read well and locate the star among its neighbors.
 */
export function starDesignation(
  seed: bigint,
  positionPc: GalacticPosition,
  luminosity: number,
): string {
  if (luminosity >= PROPER_NAME_LUMINOSITY) {
    return generatedName(deriveSeed(seed, 'star-name'));
  }
  const number = 1 + Number(deriveSeed(seed, 'catalog-number') % 99999n);
  return `${sectorName(positionPc)} ${number}`;
}
