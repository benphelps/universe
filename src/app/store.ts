import { useSyncExternalStore } from 'react';
import { seedFromHex, seedToHex } from '../core/rng/hash';
import type { GalacticPosition } from '../universe/galaxy/density';
import { galaxySeed, PRIME_GALAXY_SEED, setGalaxySeed } from '../universe/galaxy/galaxySeed';
import {
  neighborBudget,
  setNeighborBudget,
  type Neighbor,
} from '../universe/galaxy/neighborhood';
import {
  galacticAddress,
  type GalacticAddress,
  type GalacticLandmark,
} from '../universe/galaxy/regions';
import type { Asteroid } from '../universe/smallbody/types';
import type { Planet, StarSystem } from '../universe/system/types';
import { generateSystem } from '../universe/system/generate';
import type { Star } from '../universe/star/types';
import {
  bookmarkKey,
  removeMark,
  setCaption,
  toggleMark,
  type Bookmark,
} from './bookmarks';
import { getGalacticLandmarks, landmarksNow } from './landmarkService';
import { UnifiedViewer } from './unifiedViewer';
import type { DecalState } from './ui/decalToggles';
import type { GenerationStatus } from './ui/generationIndicator';
import type { Tab, ViewMode } from './ui/sidebar';
import type { CatalogGalaxy } from './galaxyCatalog';
import { GALAXY_KEY } from './ui/welcome';

/** The default pace until the surveyor speeds up: one minute a second. */
export const DEFAULT_TIME_SCALE = 1 / 1440;

/** What the planet tab has resolved to focus, after index wrapping. */
export type PlanetFocus = 'planet' | 'moon' | 'asteroid' | 'empty';

/**
 * Everything the UI renders from, rebuilt on every store change. Null
 * until the first system loads, so components see a complete world or
 * none at all.
 */
export interface AppSnapshot {
  system: StarSystem;
  seedHex: string;
  address: GalacticAddress;
  viewMode: ViewMode;
  /** The active sidebar tab — POI overlays the level, not the camera. */
  tab: Tab;
  companionIndex: number;
  planetIndex: number;
  moonIndex: number;
  planetFocus: PlanetFocus;
  /** A belt member picked in the scene: its plate overrides the focus. */
  beltPick: Asteroid | null;
  /** The camera is at the galactic centre, not in the system at all. */
  coreView: boolean;
  neighbors: Neighbor[];
  asteroids: Asteroid[];
  landmarks: GalacticLandmark[] | null;
  /** The current locale as the URL carries it. */
  at?: string;
  ridingOut: boolean;
  /** Bumped when saved marks change, so mark UI re-reads storage. */
  marksEpoch: number;
  /** Narrow screens fold the console away; this is whether it stands open. */
  consoleOpen: boolean;
}

let viewMode: ViewMode = 'star';
let seedHex = '';
let planetIndex = 0;
/** −1 = the planet itself; otherwise which of its moons is focused. */
let moonIndex = -1;
let companionIndex = 0;
let viewer: UnifiedViewer | null = null;
let system: StarSystem | null = null;
let address: GalacticAddress | null = null;
let currentLocaleKey = '';
let exposure = 1;
let timeScale = DEFAULT_TIME_SCALE;
let localePc: GalacticPosition | undefined;
/** Whether the POI tab currently owns the level section. */
let poiOpen = false;
let planetFocus: PlanetFocus = 'planet';
let beltPick: Asteroid | null = null;
let coreView = false;
let ridingOut = false;
let marksEpoch = 0;
let consoleOpen = false;

let snapshot: AppSnapshot | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  snapshot =
    system && address && viewer
      ? {
          system,
          seedHex,
          address,
          viewMode,
          tab: poiOpen ? 'poi' : viewMode,
          companionIndex,
          planetIndex,
          moonIndex,
          planetFocus,
          beltPick,
          coreView,
          neighbors: viewer.neighbors,
          asteroids: viewer.asteroids,
          landmarks: landmarksNow(),
          at: localePc ? localeParam(localePc) : undefined,
          ridingOut,
          marksEpoch,
          consoleOpen,
        }
      : null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): AppSnapshot | null {
  return snapshot;
}

export function useApp(): AppSnapshot | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** The focused host: the primary's retinue, or a companion's. */
export function host(snap: AppSnapshot): {
  star: Star;
  planets: Planet[];
  companion: StarSystem['companions'][number] | null;
} {
  const companion =
    snap.companionIndex > 0 ? snap.system.companions[snap.companionIndex - 1] : null;
  return companion
    ? { star: companion.star, planets: companion.planets, companion }
    : { star: snap.system.star, planets: snap.system.planets, companion: null };
}

function randomSeedHex(): string {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return words[0].toString(16).padStart(8, '0') + words[1].toString(16).padStart(8, '0');
}

/** Round-trips a galactic position through the URL without drift. */
function localeParam(locale: GalacticPosition): string {
  return `${locale.xPc.toFixed(4)}_${locale.yPc.toFixed(4)}_${locale.zPc.toFixed(4)}`;
}

function parseLocale(value: string | null): GalacticPosition | undefined {
  if (!value) return undefined;
  const [x, y, z] = value.split('_').map(Number);
  if (![x, y, z].every(Number.isFinite)) return undefined;
  return { xPc: x, yPc: y, zPc: z };
}

/**
 * Every view is a preset of the one unified viewer — the same scene
 * focused and framed differently — so switching between them (or
 * stepping bodies, or travelling to a neighbor star) never rebuilds
 * the renderer. Travel to a catalog star carries its true galactic
 * position, so the destination is built where the star actually is;
 * bare seeds settle at their seed-derived locale. The locale is part
 * of the system's identity: reloads of the same seed (tab switches,
 * body steps) must keep it, or the same hex regenerates as a
 * different star somewhere else.
 */
function load(nextSeedHex: string, nextLocalePc?: GalacticPosition): void {
  if (!viewer) return;
  poiOpen = false;
  beltPick = null;
  // The core view tore the system down to stand at the centre; any
  // move back into a system has to rebuild it from scratch.
  if (coreView) {
    coreView = false;
    system = null;
    currentLocaleKey = '';
  }
  const normalized = seedToHex(seedFromHex(nextSeedHex));
  localePc = nextLocalePc
    ? {
        xPc: Number(nextLocalePc.xPc.toFixed(4)),
        yPc: Number(nextLocalePc.yPc.toFixed(4)),
        zPc: Number(nextLocalePc.zPc.toFixed(4)),
      }
    : normalized === seedHex
      ? localePc
      : undefined;
  seedHex = normalized;
  const seed = seedFromHex(seedHex);

  const localeKey = localePc ? localeParam(localePc) : '';
  if (!system || system.seedHex !== seedHex || currentLocaleKey !== localeKey) {
    currentLocaleKey = localeKey;
    if (system) companionIndex = 0;
    system = generateSystem(seed, localePc);
    viewer.setSystem(system);
  }
  address = galacticAddress(system.localePc);
  companionIndex = Math.max(0, Math.min(companionIndex, system.companions.length));
  const hostPlanets =
    companionIndex === 0 ? system.planets : system.companions[companionIndex - 1].planets;
  viewer.setHost(companionIndex);
  if (viewMode === 'star') {
    viewer.setFocus('star', 'star');
  } else if (viewMode === 'system') {
    viewer.setFocus('star', 'system');
  } else if (viewMode === 'galaxy') {
    viewer.setFocus('star', 'galaxy');
  } else {
    // The body stepper walks the host's planets — for the primary, the
    // notable belt asteroids follow them.
    const count =
      companionIndex === 0 ? hostPlanets.length + viewer.asteroids.length : hostPlanets.length;
    if (count === 0) {
      viewer.setFocus('star', 'star');
      planetFocus = 'empty';
    } else {
      planetIndex = ((planetIndex % count) + count) % count;
      const moons = planetIndex < hostPlanets.length ? hostPlanets[planetIndex].moons : [];
      if (moonIndex >= 0 && moons.length > 0) {
        moonIndex = ((moonIndex % moons.length) + moons.length) % moons.length;
        viewer.setFocus({ planet: planetIndex, moon: moonIndex }, 'planet');
        planetFocus = 'moon';
      } else if (planetIndex < hostPlanets.length) {
        moonIndex = -1;
        viewer.setFocus(planetIndex, 'planet');
        planetFocus = 'planet';
      } else {
        viewer.setFocus(planetIndex, 'planet');
        planetFocus = 'asteroid';
      }
    }
  }
  viewer.timeScaleDaysPerSecond = timeScale;
  viewer.exposure = exposure;

  syncAddress();
}

/**
 * Write where we are into the address bar. Every field the boot reads
 * back, so the URL in the bar is always a link that lands someone else
 * exactly here — which is only true if it is rewritten wherever the
 * view changes, not only where a system is loaded.
 */
function syncAddress(): void {
  const url = new URL(location.href);
  url.searchParams.set('seed', seedHex);
  // Always, even in the prime galaxy. A seed means nothing without the
  // galaxy it was drawn in — the locale differs, so the same sixteen
  // digits name a different star — and a link that leaves it out is
  // read against whatever galaxy the reader happens to be standing in.
  // Writing it every time is what makes an address portable.
  url.searchParams.set('galaxy', seedToHex(galaxySeed()));
  url.searchParams.set('view', viewMode);
  if (coreView) {
    url.searchParams.set('core', '1');
  } else {
    url.searchParams.delete('core');
  }
  if (localePc) {
    url.searchParams.set('at', localeParam(localePc));
  } else {
    url.searchParams.delete('at');
  }
  if (viewMode === 'planet') {
    url.searchParams.set('planet', String(planetIndex));
  } else {
    url.searchParams.delete('planet');
  }
  if (viewMode === 'planet' && moonIndex >= 0) {
    url.searchParams.set('moon', String(moonIndex));
  } else {
    url.searchParams.delete('moon');
  }
  if (companionIndex > 0) {
    url.searchParams.set('companion', String(companionIndex));
  } else {
    url.searchParams.delete('companion');
  }
  history.replaceState(null, '', url);
  notify();
}

/**
 * Boot once the viewport element exists: pick the galaxy before
 * anything derives from it, restore the URL's focus, build the viewer,
 * and load the first system.
 */
export function boot(viewElement: HTMLElement): void {
  if (viewer) return;
  const params = new URLSearchParams(location.search);
  // Which galaxy this session materializes: the address if the link
  // carries one, otherwise the traveler's own.
  //
  // Following a link no longer moves anyone's home. It used to, and the
  // result was that every shared address quietly rewrote where you
  // lived — and, worse, that a link *without* a galaxy was read against
  // wherever you had last been sent, so the same seed named a different
  // star for every reader. Home is now set in one place only, by the
  // traveler choosing it; a link decides nothing but the trip.
  const galaxyParam = params.get('galaxy');
  if (galaxyParam) {
    setGalaxySeed(seedFromHex(galaxyParam));
  } else {
    try {
      const home = localStorage.getItem(GALAXY_KEY);
      if (home) setGalaxySeed(seedFromHex(home));
    } catch {
      // Storage unavailable: the prime galaxy, which is the default.
    }
  }
  const viewParam = params.get('view');
  viewMode =
    viewParam === 'system' || viewParam === 'planet' || viewParam === 'galaxy'
      ? viewParam
      : viewParam === 'surface'
        ? 'planet'
        : 'star';
  planetIndex = Number(params.get('planet') ?? 0) || 0;
  moonIndex = params.get('moon') === null ? -1 : Number(params.get('moon')) || 0;
  companionIndex = Number(params.get('companion') ?? 0) || 0;

  try {
    const saved = Number(localStorage.getItem(NEIGHBOR_BUDGET_KEY));
    if (Number.isFinite(saved) && saved > 0) setNeighborBudget(saved);
  } catch {
    // No storage, shipped budget.
  }

  viewer = new UnifiedViewer(viewElement);
  viewer.onRideOutChange = (active) => {
    ridingOut = active;
    notify();
  };
  // Dev/test hook: inspection access to the live viewer.
  (window as unknown as { __sim: unknown }).__sim = {
    get viewer() {
      return viewer;
    },
    viewCore,
    setTab,
  };
  // Universal picking: a click on any hoverable body acts on it.
  viewer.onPick = (target) => {
    if (!viewer || !system) return;
    if (target.kind === 'planet') {
      selectPlanet(target.index);
    } else if (target.kind === 'moon') {
      selectMoon(target.planet, target.index);
    } else if (target.kind === 'notable') {
      selectPlanet(system.planets.length + target.index);
    } else if (target.kind === 'star') {
      selectStar((target.companion ?? -1) + 1);
    } else if (target.kind === 'belt') {
      viewer.focusBeltAsteroid(target.asteroid);
      beltPick = target.asteroid;
      notify();
    } else if (target.kind === 'neighbor') {
      // Travel arrives at the destination star, not at whatever the
      // previous system had focused; the galaxy map keeps its own
      // framing so neighbor-hopping stays on the map.
      if (viewMode !== 'galaxy') viewMode = 'star';
      planetIndex = 0;
      moonIndex = -1;
      load(target.seedHex, target.positionPc);
    }
  };

  load(params.get('seed') ?? randomSeedHex(), parseLocale(params.get('at')));
  // The centre is a place a link can name, so it has to be a place a
  // link can restore.
  if (params.get('core') !== null) viewCore();

  // Chart the landmark catalog in the background; the snapshot picks
  // it up once it lands.
  void getGalacticLandmarks().then(() => notify());
}

export function toggleConsole(): void {
  consoleOpen = !consoleOpen;
  notify();
}

export function closeConsole(): void {
  if (!consoleOpen) return;
  consoleOpen = false;
  notify();
}

/**
 * Choosing a body is the end of a console errand: on a narrow screen
 * the drawer folds away so the thing you picked is what you see.
 * Switching levels is browsing, and leaves it standing.
 */
function acted(): void {
  consoleOpen = false;
}

export function setTab(tab: Tab): void {
  if (tab === 'poi') {
    poiOpen = true;
    notify();
    return;
  }
  if (tab === viewMode && !poiOpen && !coreView) return;
  viewMode = tab;
  load(seedHex);
}

/**
 * Stand at the galaxy's centre. Not a system and not a preset: the
 * viewer drops the whole stellar scene and frames the supermassive
 * hole at its own scale, with the galaxy around it. Any other
 * navigation rebuilds the system and comes back.
 */
export function viewCore(): void {
  acted();
  if (coreView) return;
  poiOpen = false;
  beltPick = null;
  coreView = true;
  viewMode = 'galaxy';
  viewer?.setCoreView();
  syncAddress();
}

export function stepBody(delta: number): void {
  acted();
  planetIndex += delta;
  moonIndex = -1;
  load(seedHex);
}

export function selectPlanet(index: number, hostIndex = companionIndex): void {
  acted();
  viewMode = 'planet';
  planetIndex = index;
  moonIndex = -1;
  companionIndex = hostIndex;
  load(seedHex);
}

export function selectMoon(planet: number, moon: number): void {
  acted();
  viewMode = 'planet';
  planetIndex = planet;
  moonIndex = moon;
  load(seedHex);
}

/** The moon plate's stepper walks the parent's moons, wrapping. */
export function stepMoon(delta: number): void {
  acted();
  moonIndex += delta;
  load(seedHex);
}

/** Focus one of the system's stars: 0 the primary, then the companions. */
export function selectStar(index: number): void {
  acted();
  viewMode = 'star';
  companionIndex = index;
  load(seedHex);
}

/** Travel to a neighbor star or landmark at its true galactic position. */
export function travelTo(destination: { seedHex: string; positionPc: GalacticPosition }): void {
  acted();
  load(destination.seedHex, destination.positionPc);
}

/**
 * Go and stand at another galaxy's centre. The galaxy locks at first
 * use, so this is a clean boot into it rather than a move within the
 * one already running — but the address it navigates to carries the
 * whole trip, which means it is also the link to hand someone else.
 */
export function travelToGalaxy(entry: CatalogGalaxy): void {
  acted();
  if (entry.galaxy === seedToHex(galaxySeed())) {
    viewCore();
    return;
  }
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set('galaxy', entry.galaxy);
  url.searchParams.set('seed', entry.seed);
  url.searchParams.set('view', 'galaxy');
  url.searchParams.set('core', '1');
  location.href = url.toString();
}

export function randomSeed(): void {
  acted();
  load(randomSeedHex());
}

/**
 * A mark within the current galaxy restores its state in place; one in
 * another galaxy needs a clean boot, since the galaxy locks at first
 * use — so it navigates. Nothing about the traveler's home is touched
 * either way: a trip is a trip.
 */
export function travelToMark(mark: Bookmark): void {
  acted();
  if (mark.galaxy !== seedToHex(galaxySeed())) {
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set('seed', mark.seed);
    url.searchParams.set('galaxy', mark.galaxy);
    url.searchParams.set('view', mark.view);
    if (mark.at) url.searchParams.set('at', mark.at);
    if (mark.view === 'planet') url.searchParams.set('planet', String(mark.planet ?? 0));
    if (mark.moon !== undefined) url.searchParams.set('moon', String(mark.moon));
    if (mark.companion) url.searchParams.set('companion', String(mark.companion));
    if (mark.core) url.searchParams.set('core', '1');
    location.href = url.toString();
    return;
  }
  if (mark.core) {
    viewCore();
    return;
  }
  viewMode = mark.view;
  planetIndex = mark.planet ?? 0;
  moonIndex = mark.moon ?? -1;
  companionIndex = mark.companion ?? 0;
  load(mark.seed, parseLocale(mark.at ?? null));
  // A system change resets the companion focus; a companion mark asks
  // for it back once the system exists.
  if (mark.companion && companionIndex !== mark.companion) {
    companionIndex = mark.companion;
    load(mark.seed);
  }
}

/**
 * The current focus as a travel link: the plate's designation plus
 * exactly the state the URL carries.
 */
export function markFor(name: string, caption: string): Bookmark {
  const mark: Bookmark = {
    name,
    caption,
    galaxy: seedToHex(galaxySeed()),
    seed: seedHex,
    view: viewMode,
  };
  if (localePc) mark.at = localeParam(localePc);
  if (viewMode === 'planet') mark.planet = planetIndex;
  if (viewMode === 'planet' && moonIndex >= 0) mark.moon = moonIndex;
  if (companionIndex > 0) mark.companion = companionIndex;
  return mark;
}

export function toggleCurrentMark(mark: Bookmark): void {
  toggleMark(mark);
  marksEpoch++;
  notify();
}

export function removeSavedMark(key: string): void {
  removeMark(key);
  marksEpoch++;
  notify();
}

export function saveCaption(key: string, caption: string): void {
  setCaption(key, caption);
  marksEpoch++;
  notify();
}

export function setExposure(value: number): void {
  exposure = value;
  if (viewer) viewer.exposure = value;
}

/** How many neighborhood stars to resolve, as a multiple of what the
 *  disk around us costs. Persisted, because it is a statement about the
 *  machine and not about the trip. */
export const NEIGHBOR_BUDGET_KEY = 'universe-neighbor-budget';

export function setStarBudget(multiple: number): void {
  setNeighborBudget(multiple);
  try {
    localStorage.setItem(NEIGHBOR_BUDGET_KEY, String(neighborBudget()));
  } catch {
    // A browser refusing storage is not a reason to refuse the setting.
  }
  // The neighborhood is built when a system is entered, so the new
  // budget needs the system built again to be spent.
  if (viewer && !coreView && seedHex) load(seedHex, localePc);
  notify();
}

export function starBudget(): number {
  return neighborBudget();
}

export function setTimeScale(daysPerSecond: number): void {
  timeScale = daysPerSecond;
  if (viewer) viewer.timeScaleDaysPerSecond = daysPerSecond;
}

export function setDecal(key: keyof DecalState, visible: boolean): void {
  if (!viewer) return;
  if (key === 'chart') viewer.chartVisible = visible;
  else if (key === 'orbits') viewer.orbitsVisible = visible;
  else if (key === 'zones') viewer.zonesVisible = visible;
  else viewer.markersVisible = visible;
}

/** The ride-out chip: press to start the slow pull-back to the galaxy
 *  frame, press again (or roll the wheel, or travel) to take it back. */
export function toggleRideOut(): void {
  if (!viewer) return;
  if (viewer.ridingOut) viewer.stopRideOut();
  else viewer.startRideOut();
}

export function generationStatus(): GenerationStatus | null {
  return viewer ? viewer.generationStatus : null;
}
