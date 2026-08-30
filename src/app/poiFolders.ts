import { seedFromHex } from '../core/rng/hash';
import { galaxyName } from '../universe/galaxy/regions';
import type { Bookmark } from './bookmarks';
import { CATALOG_GALAXIES, HOME_GALAXY, type CatalogGalaxy } from './galaxyCatalog';

/**
 * The address book, grouped the way the universe is: a galaxy holds
 * the marks inside it.
 *
 * A mark only means anything in the galaxy it was saved from — the
 * same system seed names a different star in every other one — and
 * travelling between galaxies is a reboot rather than a move, since
 * the galaxy seed locks at first use. So the galaxy is the folder, and
 * every mark files under exactly one.
 */
export interface GalaxyFolder {
  galaxy: string;
  name: string;
  /** The galaxy this session materialized: its figures come from the
   *  live nucleus, and its centre is a move rather than a reboot. */
  here: boolean;
  /** The survey's own figures, for a galaxy that cannot be generated
   *  from here to describe itself. Absent for one the traveler
   *  reached on their own. */
  entry?: CatalogGalaxy;
  /** A system to arrive in — the catalogue's, or one a mark supplies. */
  seed?: string;
  marks: Bookmark[];
}

/** Every galaxy this build can describe without being inside it. */
const KNOWN = [...CATALOG_GALAXIES, HOME_GALAXY];

/**
 * Every galaxy worth a row: where the traveler is standing, then the
 * ones the survey ships, then home, then any other galaxy holding a
 * mark. A known galaxy keeps its row whether or not anything is marked
 * in it, because the row is the destination.
 */
export function poiFolders(here: string, marks: Bookmark[]): GalaxyFolder[] {
  const held = new Map<string, Bookmark[]>();
  for (const mark of marks) {
    const kept = held.get(mark.galaxy);
    if (kept) kept.push(mark);
    else held.set(mark.galaxy, [mark]);
  }

  const order = [here, ...KNOWN.map((entry) => entry.galaxy), ...held.keys()];
  const seen = new Set<string>();
  const folders: GalaxyFolder[] = [];
  for (const galaxy of order) {
    if (seen.has(galaxy)) continue;
    seen.add(galaxy);
    const entry = KNOWN.find((candidate) => candidate.galaxy === galaxy);
    const inside = held.get(galaxy) ?? [];
    folders.push({
      galaxy,
      name: galaxyName(seedFromHex(galaxy)),
      here: galaxy === here,
      entry,
      seed: entry?.seed ?? inside[0]?.seed,
      marks: inside,
    });
  }
  return folders;
}
