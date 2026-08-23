import './style.css';
import { seedFromHex, seedToHex } from '../core/rng/hash';
import { generateStar } from '../universe/star/generate';
import { generateSystem } from '../universe/system/generate';
import { Controls, type ViewMode } from './ui/controls';
import { InfoPanel } from './ui/infoPanel';
import { GalaxyInfoPanel } from './ui/galaxyInfoPanel';
import { PlanetInfoPanel } from './ui/planetInfoPanel';
import { SystemInfoPanel } from './ui/systemInfoPanel';
import { BodyViewer } from './bodyViewer';
import { GalaxyViewer } from './galaxyViewer';
import { StarViewer } from './viewer';
import { SystemViewer } from './systemViewer';

const viewElement = document.getElementById('view')!;
const infoElement = document.getElementById('info')!;
const starPanel = new InfoPanel(infoElement);
const systemPanel = new SystemInfoPanel(infoElement);
const planetPanel = new PlanetInfoPanel(infoElement);
const galaxyPanel = new GalaxyInfoPanel(infoElement);

let viewMode: ViewMode = 'star';
let seedHex = '';
let planetIndex = 0;
let viewer: StarViewer | SystemViewer | BodyViewer | GalaxyViewer | null = null;
let exposure = 1;
let timeScale: number | null = null;

function randomSeedHex(): string {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return words[0].toString(16).padStart(8, '0') + words[1].toString(16).padStart(8, '0');
}

function load(nextSeedHex: string): void {
  seedHex = seedToHex(seedFromHex(nextSeedHex));
  const seed = seedFromHex(seedHex);

  viewer?.dispose();
  if (viewMode === 'star') {
    const star = generateStar(seed);
    const starViewer = new StarViewer(viewElement);
    starViewer.setStar(star);
    starPanel.render(star);
    viewer = starViewer;
  } else if (viewMode === 'system') {
    const system = generateSystem(seed);
    const systemViewer = new SystemViewer(viewElement);
    systemViewer.setSystem(system);
    systemPanel.render(system);
    viewer = systemViewer;
  } else if (viewMode === 'galaxy') {
    const galaxyViewer = new GalaxyViewer(viewElement);
    galaxyViewer.setSeed(seedHex);
    galaxyPanel.render(seedHex, galaxyViewer.neighbors, (nextSeed) => load(nextSeed));
    viewer = galaxyViewer;
  } else {
    const system = generateSystem(seed);
    const bodyViewer = new BodyViewer(viewElement);
    viewer = bodyViewer;
    if (system.planets.length === 0) {
      planetPanel.renderEmpty(system);
      controls.planetLabel = '—';
    } else {
      const count = system.planets.length;
      planetIndex = ((planetIndex % count) + count) % count;
      const planet = system.planets[planetIndex];
      bodyViewer.setPlanet(system, planet);
      planetPanel.render(system, planet, planetIndex);
      controls.planetLabel = planet.name.split(' ').pop() ?? '';
    }
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
