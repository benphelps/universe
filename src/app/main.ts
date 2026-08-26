import './style.css';
import { seedFromHex, seedToHex } from '../core/rng/hash';
import type { GalacticPosition } from '../universe/galaxy/density';
import { galacticAddress } from '../universe/galaxy/regions';
import { generateSystem } from '../universe/system/generate';
import type { StarSystem } from '../universe/system/types';
import { ChartToggle } from './ui/chartToggle';
import { GalaxyInfoPanel } from './ui/galaxyInfoPanel';
import { PlanetInfoPanel } from './ui/planetInfoPanel';
import { SettingsMenu, SLOWEST_TIME_EXP } from './ui/settingsMenu';
import { Sidebar, type ViewMode } from './ui/sidebar';
import { StarInfoPanel } from './ui/starInfoPanel';
import { SystemInfoPanel } from './ui/systemInfoPanel';
import { UnifiedViewer } from './unifiedViewer';

const viewElement = document.getElementById('view')!;

let viewMode: ViewMode = 'star';
let seedHex = '';
let planetIndex = 0;
let viewer: UnifiedViewer | null = null;
let system: StarSystem | null = null;
let currentLocaleKey = '';
let exposure = 1;
let timeScale = 10 ** SLOWEST_TIME_EXP;

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
  load(seedHex);
}

function selectPlanet(index: number): void {
  viewMode = 'planet';
  planetIndex = index;
  load(seedHex);
}

/**
 * Every view is a preset of the one unified viewer — the same scene
 * focused and framed differently — so switching between them (or
 * stepping bodies, or travelling to a neighbor star) never rebuilds
 * the renderer. Travel to a catalog star carries its true galactic
 * position, so the destination is built where the star actually is;
 * bare seeds settle at their seed-derived locale.
 */
function load(nextSeedHex: string, nextLocalePc?: GalacticPosition): void {
  seedHex = seedToHex(seedFromHex(nextSeedHex));
  localePc = nextLocalePc && {
    xPc: Number(nextLocalePc.xPc.toFixed(4)),
    yPc: Number(nextLocalePc.yPc.toFixed(4)),
    zPc: Number(nextLocalePc.zPc.toFixed(4)),
  };
  const seed = seedFromHex(seedHex);

  if (!viewer) {
    viewer = new UnifiedViewer(viewElement);
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
      } else if (target.kind === 'notable') {
        selectPlanet(system.planets.length + target.index);
      } else if (target.kind === 'star') {
        viewMode = 'star';
        load(seedHex);
      } else if (target.kind === 'belt') {
        viewer.focusBeltAsteroid(target.asteroid);
        planetPanel.renderAsteroid(system, target.asteroid, 'belt member');
      } else if (target.kind === 'neighbor') {
        load(target.seedHex, target.positionPc);
      }
    };
  }
  const localeKey = localePc ? localeParam(localePc) : '';
  if (!system || system.seedHex !== seedHex || currentLocaleKey !== localeKey) {
    currentLocaleKey = localeKey;
    system = generateSystem(seed, localePc);
    viewer.setSystem(system);
  }
  const address = galacticAddress(system.localePc);
  sidebar.address = address;
  if (viewMode === 'star') {
    viewer.setFocus('star', 'star');
    starPanel.render(system.star);
  } else if (viewMode === 'system') {
    viewer.setFocus('star', 'system');
    systemPanel.render(system, selectPlanet);
  } else if (viewMode === 'galaxy') {
    viewer.setFocus('star', 'galaxy');
    galaxyPanel.render(system.star, address, viewer.neighbors, (neighbor) =>
      load(neighbor.seedHex, neighbor.positionPc),
    );
  } else {
    // The body stepper walks the planets, then the notable belt asteroids.
    const count = system.planets.length + viewer.asteroids.length;
    if (count === 0) {
      viewer.setFocus('star', 'star');
      planetPanel.renderEmpty(system);
    } else {
      planetIndex = ((planetIndex % count) + count) % count;
      viewer.setFocus(planetIndex, 'planet');
      if (planetIndex < system.planets.length) {
        planetPanel.render(system, system.planets[planetIndex], planetIndex, stepBody);
      } else {
        const ordinal = planetIndex - system.planets.length;
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

  settings.seed = seedHex;
  sidebar.view = viewMode;
  const url = new URL(location.href);
  url.searchParams.set('seed', seedHex);
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
  history.replaceState(null, '', url);
}

const sidebar = new Sidebar(document.getElementById('sidebar')!, {
  onView: (mode) => {
    if (mode === viewMode) return;
    viewMode = mode;
    load(seedHex);
  },
});
const settings = new SettingsMenu(document.getElementById('settings-corner')!, {
  onSeed: load,
  onRandom: () => load(randomSeedHex()),
  onTimeScale: (daysPerSecond) => {
    timeScale = daysPerSecond;
    if (viewer) viewer.timeScaleDaysPerSecond = daysPerSecond;
  },
  onExposure: (value) => {
    exposure = value;
    if (viewer) viewer.exposure = value;
  },
});
new ChartToggle(document.getElementById('chart')!, (visible) => {
  if (viewer) viewer.chartVisible = visible;
});
const starPanel = new StarInfoPanel(sidebar);
const systemPanel = new SystemInfoPanel(sidebar);
const planetPanel = new PlanetInfoPanel(sidebar);
const galaxyPanel = new GalaxyInfoPanel(sidebar);

const params = new URLSearchParams(location.search);
const viewParam = params.get('view');
viewMode =
  viewParam === 'system' || viewParam === 'planet' || viewParam === 'galaxy'
    ? viewParam
    : viewParam === 'surface'
      ? 'planet'
      : 'star';
planetIndex = Number(params.get('planet') ?? 0) || 0;
load(params.get('seed') ?? randomSeedHex(), parseLocale(params.get('at')));
