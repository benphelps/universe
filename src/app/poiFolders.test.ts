import { describe, expect, it } from 'vitest';
import type { Bookmark } from './bookmarks';
import { CATALOG_GALAXIES, HOME_GALAXY } from './galaxyCatalog';
import { poiFolders } from './poiFolders';

const PRIME = HOME_GALAXY.galaxy;
const SHIPPED = CATALOG_GALAXIES[0].galaxy;
const UNKNOWN = '0123456789abcdef';

function mark(galaxy: string, name: string, seed = 'aaaaaaaaaaaaaaaa'): Bookmark {
  return { name, caption: '', galaxy, seed, view: 'star' };
}

describe('the address book, grouped by galaxy', () => {
  it('opens on where the traveler is standing', () => {
    // Wherever they are gets a row whether or not the survey ships it
    // and whether or not anything is marked in it — it is the one
    // galaxy whose centre is a move rather than a reboot.
    const folders = poiFolders(UNKNOWN, []);
    expect(folders[0].galaxy).toBe(UNKNOWN);
    expect(folders[0].here).toBe(true);
    expect(folders.filter((f) => f.here).length).toBe(1);
  });

  it('keeps a shipped galaxy in one row when it is also the one you are in', () => {
    const folders = poiFolders(SHIPPED, []);
    expect(folders.filter((f) => f.galaxy === SHIPPED).length).toBe(1);
    expect(folders[0].galaxy).toBe(SHIPPED);
    expect(folders[0].entry).toBeDefined();
    expect(folders.length).toBe(CATALOG_GALAXIES.length + 1);
  });

  it('files every mark under the galaxy it was saved from', () => {
    const marks = [
      mark(PRIME, 'home star'),
      mark(UNKNOWN, 'somewhere else'),
      mark(PRIME, 'home planet'),
    ];
    const folders = poiFolders(PRIME, marks);
    const home = folders.find((f) => f.galaxy === PRIME);
    expect(home?.marks.map((m) => m.name)).toEqual(['home star', 'home planet']);
    // A galaxy nobody shipped still earns a row by holding something.
    const found = folders.find((f) => f.galaxy === UNKNOWN);
    expect(found?.marks.map((m) => m.name)).toEqual(['somewhere else']);
    expect(found?.entry).toBeUndefined();
  });

  it('always has somewhere to arrive', () => {
    // Travel needs a system to land in. The catalogue carries one; a
    // galaxy known only from a mark borrows that mark's.
    const folders = poiFolders(PRIME, [mark(UNKNOWN, 'somewhere else', 'bbbbbbbbbbbbbbbb')]);
    for (const folder of folders) {
      if (!folder.here) expect(folder.seed).toBeTruthy();
    }
    expect(folders.find((f) => f.galaxy === UNKNOWN)?.seed).toBe('bbbbbbbbbbbbbbbb');
    expect(folders.find((f) => f.galaxy === SHIPPED)?.seed).toBe(CATALOG_GALAXIES[0].seed);
  });

  it('can always read home, from anywhere', () => {
    // Home is not one of the survey's four, but a traveler standing in
    // another galaxy cannot generate it to describe it either — so it
    // is carried, and its row has figures wherever it is read from.
    const away = poiFolders(CATALOG_GALAXIES[0].galaxy, []);
    expect(away.find((f) => f.galaxy === PRIME)?.entry).toBe(HOME_GALAXY);
  });

  it('names a galaxy the survey never heard of', () => {
    // The name is the galaxy's own, derived from its seed, so a folder
    // for one nobody catalogued still has something to be called.
    const folders = poiFolders(UNKNOWN, []);
    expect(folders[0].name).toMatch(/^[A-Z][a-z]+$/);
  });
});
