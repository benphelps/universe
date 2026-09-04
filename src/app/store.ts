import { useSyncExternalStore } from 'react';
import { seedFromHex, seedToHex } from '../core/rng/hash';
import type { GalacticPosition } from '../universe/galaxy/density';
import { galaxySeed, setGalaxySeed } from '../universe/galaxy/galaxySeed';
import type { Neighbor } from '../universe/galaxy/neighborhood';
import {
  galacticAddress,
  sectorNameForSeed,
  type GalacticAddress,
  type GalacticLandmark,
} from '../universe/galaxy/regions';
import { cloudReachPc, cloudsNear } from '../universe/galaxy/clouds';
import { cloudGateway } from '../universe/galaxy/gateway';
import { cloudMassSolar, cloudMeanHydrogenDensity } from '../universe/galaxy/gas';
import { ismMetallicity } from '../universe/galaxy/population';
import type { IonizingSource, NebulaKind } from '../universe/galaxy/nebula';
import {
  CAMERA_INSTRUMENT,
  EYE_INSTRUMENT,
  NARROWBAND_INSTRUMENT,
  type DisplayInstrument,
} from '../universe/galaxy/displayLaw';
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
  type SavedRow,
} from './bookmarks';
import type { BodyRowSpec } from './ui/bodyRow';
import type { PlateSpec } from './ui/plate';
import { getGalacticLandmarks, landmarksNow } from './landmarkService';
import type { LocaleInventory } from './localeInventory';
import { requestLocaleInventory } from './localeInventoryService';
import { UnifiedViewer, type FocusedCloud, type HoverPreference } from './unifiedViewer';
import type { DecalState } from './ui/decalToggles';
import type { GenerationStatus } from './ui/generationIndicator';
import type { Rung } from './ui/ladder';
import type { PerfStats } from './ui/perfReadout';
import { homeGalaxy, randomHex, setHomeGalaxy } from './home';

/** The pace before the clock control has spoken: one minute a second. */
const DEFAULT_TIME_SCALE = 1 / 1440;
/** Eclipse playback opens at real time once the paused arrival is released. */
const ECLIPSE_TIME_SCALE = 1 / 86400;

/** The preset the focus is framed at: a star at its limb, a system
 *  from above, a world from orbit, or the galaxy around a place. */
export type ViewMode = 'star' | 'system' | 'planet' | 'galaxy';

/** What the planet focus has resolved to, after index wrapping. */
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
  /** The open rung of the ladder — browsing, never framing. */
  rung: Rung;
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
  /** The molecular cloud the camera is standing off, when one is the
   *  focus rather than a body. */
  cloud: CloudSummary | null;
  /** The cloud the locale itself stands inside, whatever is focused. */
  standingCloud: CloudSummary | null;
  /** The sector's holdings and the clouds nearby; null until the
   *  chart of this locale lands. */
  inventory: LocaleInventory | null;
  /** The current locale as the URL carries it. */
  at?: string;
  /** Bumped when saved marks change, so mark UI re-reads storage. */
  marksEpoch: number;
  /** Narrow screens fold the console away; this is whether it stands open. */
  consoleOpen: boolean;
  /** Time is held, including finder arrivals held at their event epoch. */
  timePaused: boolean;
  /** Bumped when a finder asks the clock UI to seat itself at real time. */
  eclipseClockEpoch: number;
}

/** What the panels need to introduce a cloud, the way a plate
 *  introduces a planet. */
export interface CloudSummary {
  seedHex: string;
  name: string;
  kind: NebulaKind;
  radiusPc: number;
  /** Longest span across the body, pc — twice its reach from centre. */
  spanPc: number;
  massSolar: number;
  /** Mean hydrogen density over the whole cloud, cm⁻³. */
  meanDensity: number;
  /** The denser gas the ionizing stars themselves sit in, cm⁻³. */
  sourceDensity: number;
  /** The members hot enough to ionize the gas, brightest first. */
  sources: IonizingSource[];
  hottestTeff: number;
  stromgrenRadiusPc: number;
  ageMyr: number;
  metallicity: number;
}

/** A cloud's figures are pure functions of the cloud, and the mass
 *  integral behind them costs tens of milliseconds: computed once per
 *  cloud, not once per snapshot. */
const cloudSummaryCache = new Map<bigint, CloudSummary>();

function cloudSummary(focused: FocusedCloud | null): CloudSummary | null {
  if (!focused) return null;
  const cached = cloudSummaryCache.get(focused.cloud.seed);
  if (cached) return cached;
  const { cloud, nebula } = focused;
  const metallicity = nebula?.metallicity ?? ismMetallicity(cloud.positionPc);
  const summary: CloudSummary = {
    seedHex: seedToHex(cloud.seed),
    name: sectorNameForSeed(cloud.seed),
    kind: nebula?.kind ?? 'dark',
    radiusPc: cloud.radiusPc,
    spanPc: 2 * cloudReachPc(cloud),
    massSolar: cloudMassSolar(cloud, metallicity, 12),
    meanDensity: cloudMeanHydrogenDensity(cloud, metallicity),
    sourceDensity: nebula?.sourceHydrogenDensity ?? 0,
    sources: nebula?.sources ?? [],
    hottestTeff: nebula?.maxTeff ?? 0,
    stromgrenRadiusPc: nebula?.stromgrenRadiusPc ?? 0,
    ageMyr: (nebula?.ageGyr ?? 0) * 1000,
    metallicity,
  };
  cloudSummaryCache.set(cloud.seed, summary);
  if (cloudSummaryCache.size > 64) cloudSummaryCache.clear();
  return summary;
}

let viewMode: ViewMode = 'star';
let rung: Rung = 'system';
let seedHex = '';
let planetIndex = 0;
/** −1 = the planet itself; otherwise which of its moons is focused. */
let moonIndex = -1;
let companionIndex = 0;
let viewer: UnifiedViewer | null = null;
let system: StarSystem | null = null;
let address: GalacticAddress | null = null;
let inventory: LocaleInventory | null = null;
let currentLocaleKey = '';
let exposure = 1;
let timeScale = DEFAULT_TIME_SCALE;
let localePc: GalacticPosition | undefined;
let planetFocus: PlanetFocus = 'planet';
let beltPick: Asteroid | null = null;
let coreView = false;
/** True while the thing being looked at is a molecular cloud rather
 *  than a body — travel to one focuses the cloud itself. */
let cloudFocus = false;
/** The focused cloud's seed, hex, when travel named it; null leaves the
 *  viewer to take the cloud the locale stands off. */
let cloudSubjectHex: string | null = null;
let marksEpoch = 0;
let consoleOpen = false;
let timePaused = false;
let eclipseClockEpoch = 0;

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
          rung,
          companionIndex,
          planetIndex,
          moonIndex,
          planetFocus,
          beltPick,
          coreView,
          neighbors: viewer.neighbors,
          asteroids: viewer.asteroids,
          landmarks: landmarksNow(),
          cloud: cloudFocus ? cloudSummary(viewer.focusedCloud) : null,
          standingCloud: coreView ? null : cloudSummary(viewer.standingCloud),
          inventory,
          at: localePc ? localeParam(localePc) : undefined,
          marksEpoch,
          consoleOpen,
          timePaused,
          eclipseClockEpoch,
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
 * of the system's identity: reloads of the same seed (body steps)
 * must keep it, or the same hex regenerates as a different star
 * somewhere else.
 */
function load(nextSeedHex: string, nextLocalePc?: GalacticPosition): void {
  if (!viewer) return;
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
    // The surroundings are charted off the frame loop; the ladder's
    // rungs read their counts once the chart lands.
    inventory = null;
    requestLocaleInventory(system.localePc, (charted) => {
      inventory = charted;
      notify();
    });
  }
  address = galacticAddress(system.localePc);
  companionIndex = Math.max(0, Math.min(companionIndex, system.companions.length));
  const hostPlanets =
    companionIndex === 0 ? system.planets : system.companions[companionIndex - 1].planets;
  viewer.setHost(companionIndex);
  if (cloudFocus) {
    viewer.setCloudSubject(cloudSubjectHex ? seedFromHex(cloudSubjectHex) : null);
    viewer.setFocus('cloud', 'galaxy');
  } else if (viewMode === 'star') {
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
  viewer.timeScaleDaysPerSecond = timePaused ? 0 : timeScale;
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
  // A cloud is the subject, not the gateway star that shares its
  // locale: without this a shared link reopens on the star.
  if (cloudFocus) {
    url.searchParams.set('cloud', cloudSubjectHex ?? '1');
  } else {
    url.searchParams.delete('cloud');
  }
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
  setGalaxySeed(seedFromHex(params.get('galaxy') ?? homeGalaxy()));
  const viewParam = params.get('view');
  viewMode =
    viewParam === 'system' || viewParam === 'planet' || viewParam === 'galaxy'
      ? viewParam
      : viewParam === 'surface'
        ? 'planet'
        : 'star';
  const cloudParam = params.get('cloud');
  cloudFocus = cloudParam !== null;
  cloudSubjectHex = cloudParam && cloudParam !== '1' ? cloudParam : null;
  planetIndex = Number(params.get('planet') ?? 0) || 0;
  moonIndex = params.get('moon') === null ? -1 : Number(params.get('moon')) || 0;
  companionIndex = Number(params.get('companion') ?? 0) || 0;
  // The ladder opens at the level the link's focus lives on.
  rung =
    params.get('core') !== null
      ? 'galaxy'
      : cloudFocus
        ? 'nebula'
        : viewMode === 'planet'
          ? 'world'
          : 'system';

  viewer = new UnifiedViewer(viewElement);
  viewer.hoverPreference = HOVER_PREFERENCE[rung];
  // Dev/test hook: inspection access to the live viewer.
  (window as unknown as { __sim: unknown }).__sim = {
    get viewer() {
      return viewer;
    },
    viewCore,
    setRung,
  };
  // Universal picking: a click on any body frames that body at its
  // own scale, whatever was framed before.
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
    } else if (target.kind === 'cloud') {
      arriveAtCloud(target.cloudSeedHex, target.positionPc, 'nebula');
    } else if (target.kind === 'neighbor') {
      travelTo(target);
    }
  };

  load(params.get('seed') ?? randomHex(), parseLocale(params.get('at')));
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
 * Opening a rung is browsing, and leaves it standing.
 */
function acted(): void {
  consoleOpen = false;
}

/** What each rung is about, which is what the cursor reaches for in
 *  the sky while it stands open. */
const HOVER_PREFERENCE: Record<Rung, HoverPreference> = {
  universe: null,
  galaxy: null,
  sector: 'clouds',
  nebula: 'clouds',
  nearby: 'stars',
  system: 'bodies',
  world: 'bodies',
  marks: null,
};

/** Open a rung of the ladder. Browsing only: the camera stays where
 *  it is, and nothing is framed until something is clicked — but the
 *  hover in the sky prefers what the open rung is about. */
export function setRung(next: Rung): void {
  rung = next;
  if (viewer) viewer.hoverPreference = HOVER_PREFERENCE[next];
  notify();
}

/** Every body pick frames that body, and opens the rung the body's
 *  own level lists it under: a cloud focus ends here. */
function focusBody(mode: ViewMode, level: Rung): void {
  cloudFocus = false;
  cloudSubjectHex = null;
  viewMode = mode;
  setRung(level);
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
  beltPick = null;
  coreView = true;
  focusBody('galaxy', 'galaxy');
  viewer?.setCoreView();
  syncAddress();
}

export function stepBody(delta: number): void {
  acted();
  focusBody('planet', 'world');
  planetIndex += delta;
  moonIndex = -1;
  load(seedHex);
}

export function selectPlanet(index: number, hostIndex = companionIndex): void {
  acted();
  focusBody('planet', 'world');
  planetIndex = index;
  moonIndex = -1;
  companionIndex = hostIndex;
  load(seedHex);
}

export function selectMoon(planet: number, moon: number): void {
  acted();
  focusBody('planet', 'world');
  planetIndex = planet;
  moonIndex = moon;
  load(seedHex);
}

/** The moon plate's stepper walks the parent's moons, wrapping. */
export function stepMoon(delta: number): void {
  acted();
  focusBody('planet', 'world');
  moonIndex += delta;
  load(seedHex);
}

/** Focus one of the system's stars: 0 the primary, then the companions. */
export function selectStar(index: number): void {
  acted();
  focusBody('star', 'system');
  companionIndex = index;
  load(seedHex);
}

/** Frame the focused host's whole system from above. */
export function selectSystemMap(): void {
  acted();
  focusBody('system', 'system');
  load(seedHex);
}

/** Travel to a star at its true galactic position, arriving at the
 *  star itself: a destination is framed as what it is, not through
 *  whatever the last system had focused. */
export function travelTo(destination: { seedHex: string; positionPc: GalacticPosition }): void {
  acted();
  focusBody('star', 'system');
  planetIndex = 0;
  moonIndex = -1;
  load(destination.seedHex, destination.positionPc);
}

/**
 * Travel to a molecular cloud. The destination is a place rather than a
 * body: it is visited from its gateway — the nearest star outside its
 * gas, off its thinnest side — and arrives on the galaxy map looking at
 * the cloud, not in a system view looking at that star. A sector's
 * anchor opens the sector it names; any other cloud, the nebula rung.
 */
export function travelToCloud(
  destination: { cloudSeedHex: string; positionPc: GalacticPosition },
  level: Rung = 'nebula',
): void {
  acted();
  arriveAtCloud(destination.cloudSeedHex, destination.positionPc, level);
}

/** Stand off the cloud with this seed, found again by its position. */
function arriveAtCloud(cloudSeedHex: string, positionPc: GalacticPosition, level: Rung): void {
  const seed = seedFromHex(cloudSeedHex);
  const cloud = cloudsNear(positionPc, 5).find((candidate) => candidate.seed === seed);
  if (!cloud) return;
  const gateway = cloudGateway(cloud);
  viewMode = 'galaxy';
  planetIndex = 0;
  moonIndex = -1;
  cloudFocus = true;
  cloudSubjectHex = cloudSeedHex;
  setRung(level);
  load(gateway.seedHex, gateway.positionPc);
}

/**
 * Go and stand at another galaxy's centre. The galaxy locks at first
 * use, so this is a clean boot into it rather than a move within the
 * one already running — but the address it navigates to carries the
 * whole trip, which means it is also the link to hand someone else.
 */
export function travelToGalaxy(destination: { galaxy: string; seed?: string }): void {
  acted();
  if (destination.galaxy === seedToHex(galaxySeed()) || !destination.seed) {
    viewCore();
    return;
  }
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set('galaxy', destination.galaxy);
  url.searchParams.set('seed', destination.seed);
  url.searchParams.set('view', 'galaxy');
  url.searchParams.set('core', '1');
  location.href = url.toString();
}

/** A random system of this galaxy, framed the way the current one is. */
export function randomSeed(): void {
  acted();
  load(randomHex());
}

/** A galaxy nobody has stood in: a fresh seed, entered at its centre. */
export function travelToNewGalaxy(): void {
  travelToGalaxy({ galaxy: randomHex(), seed: randomHex() });
}

/** Make the galaxy this session stands in the one bare visits boot into. */
export function makeHome(): void {
  setHomeGalaxy(seedToHex(galaxySeed()));
  notify();
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
  focusBody(mark.view, mark.view === 'planet' ? 'world' : mark.view === 'galaxy' ? 'nebula' : 'system');
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
export function markFor(spec: PlateSpec): Bookmark {
  const mark: Bookmark = {
    name: spec.title,
    caption: spec.subtitle,
    galaxy: seedToHex(galaxySeed()),
    seed: seedHex,
    view: viewMode,
  };
  if (localePc) mark.at = localeParam(localePc);
  if (viewMode === 'planet') mark.planet = planetIndex;
  if (viewMode === 'planet' && moonIndex >= 0) mark.moon = moonIndex;
  if (companionIndex > 0) mark.companion = companionIndex;
  if (coreView) mark.core = true;
  if (spec.row) mark.row = savedRow(spec.row);
  return mark;
}

/**
 * The storable half of a row: what the body looks like, with none of
 * what this session can do about it. Travel is rebuilt from the
 * address, so a saved click would be a stale closure and a saved
 * "you are here" would be a lie the moment it was written.
 */
function savedRow(row: BodyRowSpec): SavedRow {
  const saved: SavedRow = {};
  if (row.color) saved.color = row.color;
  if (row.kind) saved.kind = row.kind;
  if (row.figures?.length) saved.figures = [...row.figures];
  if (row.badges?.length) saved.badges = [...row.badges];
  return saved;
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

export type SkyInstrumentName = 'camera' | 'eye' | 'narrowband';
const SKY_INSTRUMENTS: Record<SkyInstrumentName, DisplayInstrument> = {
  camera: CAMERA_INSTRUMENT,
  eye: EYE_INSTRUMENT,
  narrowband: NARROWBAND_INSTRUMENT,
};
let skyInstrumentName: SkyInstrumentName = 'camera';
let skyExposure = 1;

/** The sky's instrument: which detector the night answers to, and how
 *  deep it integrates. One seating for points, glow, sprites and
 *  volumes alike. */
export function setSkyInstrument(name: SkyInstrumentName): void {
  skyInstrumentName = name;
  viewer?.setSkyInstrument(SKY_INSTRUMENTS[name], skyExposure);
}

export function setSkyExposure(value: number): void {
  skyExposure = value;
  viewer?.setSkyInstrument(SKY_INSTRUMENTS[skyInstrumentName], skyExposure);
}

export function setTimeScale(daysPerSecond: number): void {
  timeScale = daysPerSecond;
  if (viewer) viewer.timeScaleDaysPerSecond = timePaused ? 0 : daysPerSecond;
}

export function setTimePaused(paused: boolean): void {
  if (timePaused === paused) return;
  timePaused = paused;
  if (viewer) viewer.timeScaleDaysPerSecond = paused ? 0 : timeScale;
  notify();
}

/** The orbital epoch visible now; finder tools use it as "from now". */
export function simulationTimeDays(): number {
  return viewer?.simulationTimeDays ?? 0;
}

/** Travel to a finder result, held just before the event begins. */
export function travelToEclipse(destination: {
  seedHex: string;
  positionPc: GalacticPosition;
  hostIndex: number;
  planetIndex: number;
  timeDays: number;
  arrivalTimeDays: number;
  surfaceDirection: [number, number, number];
  sunDirection: [number, number, number];
}): void {
  acted();
  timePaused = true;
  timeScale = ECLIPSE_TIME_SCALE;
  eclipseClockEpoch++;
  if (viewer) viewer.simulationTimeDays = destination.arrivalTimeDays;
  focusBody('planet', 'world');
  planetIndex = destination.planetIndex;
  moonIndex = -1;
  companionIndex = destination.hostIndex;
  load(destination.seedHex, destination.positionPc);
  // A system change deliberately resets host selection. Restore a
  // companion-hosted destination once that system has materialized.
  if (companionIndex !== destination.hostIndex) {
    companionIndex = destination.hostIndex;
    planetIndex = destination.planetIndex;
    load(destination.seedHex);
  }
  viewer?.landAtSurface(destination.surfaceDirection, destination.sunDirection);
}

export function setDecal(key: keyof DecalState, visible: boolean): void {
  if (!viewer) return;
  if (key === 'chart') viewer.chartVisible = visible;
  else if (key === 'orbits') viewer.orbitsVisible = visible;
  else if (key === 'zones') viewer.zonesVisible = visible;
  else viewer.markersVisible = visible;
}

/** The view as it stands, drawn at twice the screen's pixels and
 *  handed to the browser as a download. */
export async function captureView(): Promise<void> {
  if (!viewer) return;
  const blob = await viewer.capture(2);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `universe-${seedHex}-${coreView ? 'core' : viewMode}.png`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function generationStatus(): GenerationStatus | null {
  return viewer ? viewer.generationStatus : null;
}

export function perfStats(): PerfStats | null {
  return viewer ? viewer.perfStats : null;
}
