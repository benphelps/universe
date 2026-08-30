import type { ViewMode } from './ui/sidebar';

/**
 * A bookmark is a travel link: everything the URL needs to stand at a
 * body again — galaxy, system seed, locale, view, and body indices —
 * plus the plate's designation from the moment it was saved. Saved
 * marks live per browser; the survey ships its own highlights.
 */
export interface Bookmark {
  name: string;
  caption: string;
  galaxy: string;
  seed: string;
  view: ViewMode;
  planet?: number;
  moon?: number;
  companion?: number;
  at?: string;
  /** Set for the galaxy's centre — a place with no system in it. */
  core?: boolean;
}

const STORE_KEY = 'universe-bookmarks';

const PRIME = '53494d5f554e4956';

/** The survey's own highlights: known remarkable bodies of the prime galaxy. */
export const SURVEY_MARKS: Bookmark[] = [
  {
    name: 'Doni LIY7 i',
    caption: 'the survey’s best Earth analog — 288 K, N₂/O₂ air, oceans, a biosphere',
    galaxy: PRIME,
    seed: '92c174576e06c1d3',
    view: 'planet',
    planet: 7,
  },
  {
    name: 'Thoubreim WJQR c',
    caption: 'an 80%-ocean super-earth rolled retrograde, its nights lit by a moon three full-Moons bright',
    galaxy: PRIME,
    seed: '00000000000b8ef5',
    view: 'planet',
    planet: 1,
  },
  {
    name: 'Syavelaekryak P7N9',
    caption: 'a red dwarf whose sky the great Marusyaveim complex owns outright',
    galaxy: PRIME,
    seed: '78e011100ad27e30',
    view: 'star',
  },
  {
    name: 'Marudiak JOQT k',
    caption: '70% oceans at 1 g, rolled to a 48° tilt — seasons without mercy',
    galaxy: PRIME,
    seed: '48194251ddfaeff4',
    view: 'planet',
    planet: 9,
  },
];

/** One body, one key: the identity a toggle flips. */
export function bookmarkKey(mark: Bookmark): string {
  return [
    mark.galaxy,
    mark.seed,
    mark.core ? 'core' : mark.view,
    mark.at ?? '',
    mark.planet ?? -1,
    mark.moon ?? -1,
    mark.companion ?? 0,
  ].join('|');
}

export function savedMarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Bookmark[]) : [];
  } catch {
    return [];
  }
}

function store(marks: Bookmark[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(marks));
  } catch {
    // Storage unavailable: marks last only as long as the page.
  }
}

export function isMarked(key: string): boolean {
  return savedMarks().some((mark) => bookmarkKey(mark) === key);
}

/** Save or unsave; returns whether the body is now marked. */
export function toggleMark(mark: Bookmark): boolean {
  const marks = savedMarks();
  const key = bookmarkKey(mark);
  const kept = marks.filter((saved) => bookmarkKey(saved) !== key);
  if (kept.length < marks.length) {
    store(kept);
    return false;
  }
  store([...marks, mark]);
  return true;
}

export function removeMark(key: string): void {
  store(savedMarks().filter((mark) => bookmarkKey(mark) !== key));
}

/** The note starts as the plate's subtitle; the owner can rewrite it. */
export function setCaption(key: string, caption: string): void {
  store(savedMarks().map((mark) => (bookmarkKey(mark) === key ? { ...mark, caption } : mark)));
}
