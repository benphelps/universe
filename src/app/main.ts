import './style.css';
import { seedFromHex, seedToHex } from '../core/rng/hash';
import { generateSystem } from '../universe/system/generate';
import type { StarSystem } from '../universe/system/types';
import { Controls, type ViewMode } from './ui/controls';
import { InfoPanel } from './ui/infoPanel';
import { GalaxyInfoPanel } from './ui/galaxyInfoPanel';
import { PlanetInfoPanel } from './ui/planetInfoPanel';
import { SystemInfoPanel } from './ui/systemInfoPanel';
import { PRESET_TIME_SCALE, UnifiedViewer } from './unifiedViewer';

const viewElement = document.getElementById('view')!;
const infoElement = document.getElementById('info')!;
const starPanel = new InfoPanel(infoElement);
const systemPanel = new SystemInfoPanel(infoElement);
const planetPanel = new PlanetInfoPanel(infoElement);
const galaxyPanel = new GalaxyInfoPanel(infoElement);

let viewMode: ViewMode = 'star';
let seedHex = '';
let planetIndex = 0;
let viewer: UnifiedViewer | null = null;
let system: StarSystem | null = null;
let exposure = 1;
let timeScale: number | null = null;

function randomSeedHex(): string {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return words[0].toString(16).padStart(8, '0') + words[1].toString(16).padStart(8, '0');
}

/**
 * Every view is a preset of the one unified viewer — the same scene
 * focused and framed differently — so switching between them (or
 * stepping planets, or travelling to a neighbor star) never rebuilds
 * the renderer.
 */
function load(nextSeedHex: string): void {
  seedHex = seedToHex(seedFromHex(nextSeedHex));
  const seed = seedFromHex(seedHex);

  if (!viewer) viewer = new UnifiedViewer(viewElement);
  if (!system || system.seedHex !== seedHex) {
    system = generateSystem(seed);
    viewer.setSystem(system);
  }
  if (viewMode === 'star') {
    viewer.setFocus('star', 'star');
    starPanel.render(system.star);
  } else if (viewMode === 'system') {
    viewer.setFocus('star', 'system');
    systemPanel.render(system);
  } else if (viewMode === 'galaxy') {
    viewer.setFocus('star', 'galaxy');
    galaxyPanel.render(seedHex, viewer.neighbors, (nextSeed) => load(nextSeed));
  } else {
    // The body stepper walks the planets, then the notable belt asteroids.
    const count = system.planets.length + viewer.asteroids.length;
    if (count === 0) {
      viewer.setFocus('star', 'star');
      planetPanel.renderEmpty(system);
      controls.planetLabel = '—';
    } else {
      planetIndex = ((planetIndex % count) + count) % count;
      viewer.setFocus(planetIndex, 'planet');
      if (planetIndex < system.planets.length) {
        const planet = system.planets[planetIndex];
        planetPanel.render(system, planet, planetIndex);
        controls.planetLabel = planet.name.split(' ').pop() ?? '';
      } else {
        const ordinal = planetIndex - system.planets.length;
        planetPanel.renderAsteroid(
          system,
          viewer.asteroids[ordinal],
          ordinal + 1,
          viewer.asteroids.length,
        );
        controls.planetLabel = `A${ordinal + 1}`;
      }
    }
  }
  viewer.timeScaleDaysPerSecond = timeScale ?? PRESET_TIME_SCALE[viewMode];
  viewer.exposure = exposure;

  controls.seed = seedHex;
  controls.view = viewMode;
  const url = new URL(location.href);
  url.searchParams.set('seed', seedHex);
  url.searchParams.set('view', viewMode);
  if (viewMode === 'planet') {
    url.searchParams.set('planet', String(planetIndex));
  } else {
    url.searchParams.delete('planet');
  }
  history.replaceState(null, '', url);
}

const controls = new Controls(document.getElementById('controls')!, {
  onSeed: load,
  onRandom: () => load(randomSeedHex()),
  onView: (mode) => {
    if (mode === viewMode) return;
    viewMode = mode;
    timeScale = null;
    load(seedHex);
  },
  onPlanetStep: (delta) => {
    if (viewMode !== 'planet') return;
    planetIndex += delta;
    load(seedHex);
  },
  onTimeScale: (daysPerSecond) => {
    timeScale = daysPerSecond;
    if (viewer) viewer.timeScaleDaysPerSecond = daysPerSecond;
  },
  onExposure: (value) => {
    exposure = value;
    if (viewer) viewer.exposure = value;
  },
});

const params = new URLSearchParams(location.search);
const viewParam = params.get('view');
viewMode =
  viewParam === 'system' || viewParam === 'planet' || viewParam === 'galaxy'
    ? viewParam
    : viewParam === 'surface'
      ? 'planet'
      : 'star';
planetIndex = Number(params.get('planet') ?? 0) || 0;
load(params.get('seed') ?? randomSeedHex());
