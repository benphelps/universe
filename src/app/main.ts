import { seedFromHex, seedToHex } from '../core/rng/hash';
import { galaxySeed, PRIME_GALAXY_SEED, setGalaxySeed } from '../universe/galaxy/galaxySeed';
import { getGalacticLandmarks, landmarksNow } from './landmarkService';
import type { GalacticPosition } from '../universe/galaxy/density';
import { galacticAddress } from '../universe/galaxy/regions';
import { generateSystem } from '../universe/system/generate';
import type { StarSystem } from '../universe/system/types';
import { DecalToggles } from './ui/decalToggles';
import { GenerationIndicator } from './ui/generationIndicator';
import { GalaxyInfoPanel } from './ui/galaxyInfoPanel';
import { PlanetInfoPanel } from './ui/planetInfoPanel';
import { SettingsMenu } from './ui/settingsMenu';
import { TimeSeedControls, DEFAULT_TIME_SCALE } from './ui/timeSeedControls';
import { Sidebar, type ViewMode } from './ui/sidebar';
import { StarInfoPanel } from './ui/starInfoPanel';
import { SystemInfoPanel } from './ui/systemInfoPanel';
import { UnifiedViewer } from './unifiedViewer';
import { showWelcome } from './ui/welcome';

const viewElement = document.getElementById('view')!;

let viewMode: ViewMode = 'star';
let seedHex = '';
let planetIndex = 0;
/** −1 = the planet itself; otherwise which of its moons is focused. */
let moonIndex = -1;
let companionIndex = 0;
let viewer: UnifiedViewer | null = null;
let system: StarSystem | null = null;
let currentLocaleKey = '';
let exposure = 1;
let timeScale = DEFAULT_TIME_SCALE;

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

let localePc: GalacticPosition | undefined;

function stepBody(delta: number): void {
  planetIndex += delta;
  moonIndex = -1;
  load(seedHex);
}

function selectPlanet(index: number, host = companionIndex): void {
  viewMode = 'planet';
  planetIndex = index;
  moonIndex = -1;
  companionIndex = host;
  load(seedHex);
}

function selectMoon(planet: number, moon: number): void {
  viewMode = 'planet';
  planetIndex = planet;
  moonIndex = moon;
  load(seedHex);
}

/** The moon plate's stepper walks the parent's moons, wrapping. */
function stepMoon(delta: number): void {
  moonIndex += delta;
  load(seedHex);
}

/** Focus one of the system's stars: 0 the primary, then the companions. */
function selectStar(index: number): void {
  viewMode = 'star';
  companionIndex = index;
  load(seedHex);
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

  if (!viewer) {
    viewer = new UnifiedViewer(viewElement);
    viewer.onRideOutChange = (active) =>
      document.getElementById('ride')!.classList.toggle('active', active);
    // Dev/test hook: inspection access to the live viewer.
    (window as unknown as { __sim: unknown }).__sim = {
      get viewer() {
        return viewer;
      },
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
        planetPanel.renderAsteroid(system, target.asteroid, 'belt member');
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
  }
  const localeKey = localePc ? localeParam(localePc) : '';
  if (!system || system.seedHex !== seedHex || currentLocaleKey !== localeKey) {
    currentLocaleKey = localeKey;
    if (system) companionIndex = 0;
    system = generateSystem(seed, localePc);
    viewer.setSystem(system);
  }
  const address = galacticAddress(system.localePc);
  sidebar.address = address;
  companionIndex = Math.max(0, Math.min(companionIndex, system.companions.length));
  const hostPlanets =
    companionIndex === 0 ? system.planets : system.companions[companionIndex - 1].planets;
  const hostStar = companionIndex === 0 ? system.star : system.companions[companionIndex - 1].star;
  viewer.setHost(companionIndex);
  if (viewMode === 'star') {
    viewer.setFocus('star', 'star');
    starPanel.render(hostStar, system.star, companionIndex, selectStar, viewer.neighbors, (neighbor) =>
      load(neighbor.seedHex, neighbor.positionPc),
    );
  } else if (viewMode === 'system') {
    viewer.setFocus('star', 'system');
    systemPanel.render(system, companionIndex, (index) => selectPlanet(index, companionIndex));
  } else if (viewMode === 'galaxy') {
    viewer.setFocus('star', 'galaxy');
    galaxyPanel.render(
      system.star,
      address,
      viewer.neighbors,
      system.localePc,
      landmarksNow(),
      (destination) => load(destination.seedHex, destination.positionPc),
    );
  } else {
    // The body stepper walks the host's planets — for the primary, the
    // notable belt asteroids follow them.
    const count =
      companionIndex === 0 ? hostPlanets.length + viewer.asteroids.length : hostPlanets.length;
    if (count === 0) {
      viewer.setFocus('star', 'star');
      planetPanel.renderEmpty(hostStar);
    } else {
      planetIndex = ((planetIndex % count) + count) % count;
      const moons = planetIndex < hostPlanets.length ? hostPlanets[planetIndex].moons : [];
      if (moonIndex >= 0 && moons.length > 0) {
        moonIndex = ((moonIndex % moons.length) + moons.length) % moons.length;
        viewer.setFocus({ planet: planetIndex, moon: moonIndex }, 'planet');
        planetPanel.renderMoon(hostStar, hostPlanets[planetIndex], planetIndex, moonIndex, stepMoon, () =>
          selectPlanet(planetIndex),
        );
      } else if (planetIndex < hostPlanets.length) {
        moonIndex = -1;
        viewer.setFocus(planetIndex, 'planet');
        planetPanel.render(hostStar, hostPlanets, hostPlanets[planetIndex], planetIndex, stepBody, (moon) =>
          selectMoon(planetIndex, moon),
        );
      } else {
        viewer.setFocus(planetIndex, 'planet');
        const ordinal = planetIndex - hostPlanets.length;
        planetPanel.renderAsteroid(
          system,
          viewer.asteroids[ordinal],
          `belt asteroid ${ordinal + 1} of ${viewer.asteroids.length}`,
          stepBody,
        );
      }
    }
  }
  viewer.timeScaleDaysPerSecond = timeScale;
  viewer.exposure = exposure;

  timeSeed.seed = seedHex;
  sidebar.view = viewMode;
  const url = new URL(location.href);
  url.searchParams.set('seed', seedHex);
  if (galaxySeed() !== PRIME_GALAXY_SEED) {
    url.searchParams.set('galaxy', seedToHex(galaxySeed()));
  } else {
    url.searchParams.delete('galaxy');
  }
  url.searchParams.set('view', viewMode);
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
}

const sidebar = new Sidebar(document.getElementById('sidebar')!, {
  onView: (mode) => {
    if (mode === viewMode) return;
    viewMode = mode;
    load(seedHex);
  },
});
new SettingsMenu(document.getElementById('settings-corner')!, {
  onExposure: (value) => {
    exposure = value;
    if (viewer) viewer.exposure = value;
  },
});
const timeSeed = new TimeSeedControls(document.getElementById('timeseed')!, {
  onTimeScale: (daysPerSecond) => {
    timeScale = daysPerSecond;
    if (viewer) viewer.timeScaleDaysPerSecond = daysPerSecond;
  },
  onRandom: () => load(randomSeedHex()),
});
new DecalToggles(document.getElementById('decals')!, (key, visible) => {
  if (!viewer) return;
  if (key === 'chart') viewer.chartVisible = visible;
  else if (key === 'orbits') viewer.orbitsVisible = visible;
  else if (key === 'zones') viewer.zonesVisible = visible;
  else viewer.markersVisible = visible;
});
const generation = new GenerationIndicator(sidebar.generation);
setInterval(() => {
  if (viewer) generation.update(viewer.generationStatus);
}, 250);

// The ride-out chip: press to start the slow pull-back to the galaxy
// frame, press again (or roll the wheel, or travel) to take it back.
document.getElementById('ride')!.addEventListener('click', () => {
  if (!viewer) return;
  if (viewer.ridingOut) viewer.stopRideOut();
  else viewer.startRideOut();
});
const starPanel = new StarInfoPanel(sidebar);
const systemPanel = new SystemInfoPanel(sidebar);
const planetPanel = new PlanetInfoPanel(sidebar);
const galaxyPanel = new GalaxyInfoPanel(sidebar);

const params = new URLSearchParams(location.search);
// The galaxy must be chosen before anything derives from it.
const galaxyParam = params.get('galaxy');
if (galaxyParam) setGalaxySeed(seedFromHex(galaxyParam));
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
load(params.get('seed') ?? randomSeedHex(), parseLocale(params.get('at')));

// Chart the landmark catalog in the background; refresh the galaxy
// tab once it lands.
void getGalacticLandmarks().then(() => {
  if (viewMode === 'galaxy') load(seedHex);
});

showWelcome();
