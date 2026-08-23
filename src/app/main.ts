import './style.css';
import { seedFromHex, seedToHex } from '../core/rng/hash';
import { generateSystem } from '../universe/system/generate';
import type { StarSystem } from '../universe/system/types';
import { Controls, type ViewMode } from './ui/controls';
import { InfoPanel } from './ui/infoPanel';
import { GalaxyInfoPanel } from './ui/galaxyInfoPanel';
import { PlanetInfoPanel } from './ui/planetInfoPanel';
import { SystemInfoPanel } from './ui/systemInfoPanel';
import { GalaxyViewer } from './galaxyViewer';
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
let viewer: UnifiedViewer | GalaxyViewer | null = null;
let system: StarSystem | null = null;
let exposure = 1;
let timeScale: number | null = null;

function randomSeedHex(): string {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return words[0].toString(16).padStart(8, '0') + words[1].toString(16).padStart(8, '0');
}

/**
 * Star, system, and planet are presets of the one unified viewer — the
 * same scene focused and framed differently — so switching between them
 * (or stepping planets) never rebuilds the renderer. Only the galaxy
 * view still swaps viewers; folding it in is the renderer's last step.
 */
function load(nextSeedHex: string): void {
  seedHex = seedToHex(seedFromHex(nextSeedHex));
  const seed = seedFromHex(seedHex);

  if (viewMode === 'galaxy') {
    viewer?.dispose();
    system = null;
    const galaxyViewer = new GalaxyViewer(viewElement);
    galaxyViewer.setSeed(seedHex);
    galaxyPanel.render(seedHex, galaxyViewer.neighbors, (nextSeed) => load(nextSeed));
    viewer = galaxyViewer;
  } else {
    if (!(viewer instanceof UnifiedViewer)) {
      viewer?.dispose();
      viewer = new UnifiedViewer(viewElement);
      system = null;
    }
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
    } else if (system.planets.length === 0) {
      viewer.setFocus('star', 'star');
      planetPanel.renderEmpty(system);
      controls.planetLabel = '—';
    } else {
      const count = system.planets.length;
      planetIndex = ((planetIndex % count) + count) % count;
      const planet = system.planets[planetIndex];
      viewer.setFocus(planetIndex, 'planet');
      planetPanel.render(system, planet, planetIndex);
      controls.planetLabel = planet.name.split(' ').pop() ?? '';
    }
    viewer.timeScaleDaysPerSecond = timeScale ?? PRESET_TIME_SCALE[viewMode];
  }
  viewer.exposure = exposure;
  if (timeScale !== null) viewer.timeScaleDaysPerSecond = timeScale;

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
