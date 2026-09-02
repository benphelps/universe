import type { Badge, Figure } from './ui/bodyRow';
import type { ViewMode } from './store';

/**
 * How a body's own row read at the moment it was marked.
 *
 * A galaxy locks at first use, so a session standing anywhere else can
 * never regenerate the world a mark points at to measure it — and the
 * only marks worth travelling to are usually the ones somewhere else.
 * Without this a saved world came back as a bare name in a list where
 * everything around it carried its mass and its class. So the row is
 * kept with the address: the traveler saw those figures when they
 * marked it, and they are the figures it still has.
 */
export interface SavedRow {
  color?: string;
  kind?: string;
  figures?: Figure[];
  badges?: Badge[];
}

/**
 * A bookmark is a travel link: everything the URL needs to stand at a
 * body again — galaxy, system seed, locale, view, and body indices —
 * plus the plate's designation from the moment it was saved. Marks
 * live per browser and nothing ships in them: the galaxies in
 * galaxyCatalog are the only places the survey names for you.
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
  /** The body as it read when it was saved; absent on marks made
   *  before the survey started keeping them. */
  row?: SavedRow;
}

const STORE_KEY = 'universe-bookmarks';

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
