import './style.css';
import { seedFromHex, seedToHex } from '../core/rng/hash';
import { generateStar } from '../universe/star/generate';
import { generateSystem } from '../universe/system/generate';
import { Controls, type ViewMode } from './ui/controls';
import { InfoPanel } from './ui/infoPanel';
import { PlanetInfoPanel } from './ui/planetInfoPanel';
import { SystemInfoPanel } from './ui/systemInfoPanel';
import { PlanetViewer } from './planetViewer';
import { StarViewer } from './viewer';
import { SurfaceViewer } from './surfaceViewer';
import { SystemViewer } from './systemViewer';

const viewElement = document.getElementById('view')!;
const infoElement = document.getElementById('info')!;
const starPanel = new InfoPanel(infoElement);
const systemPanel = new SystemInfoPanel(infoElement);
const planetPanel = new PlanetInfoPanel(infoElement);

let viewMode: ViewMode = 'star';
let seedHex = '';
let planetIndex = 0;
let viewer: StarViewer | SystemViewer | PlanetViewer | SurfaceViewer | null = null;
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
  } else {
    const system = generateSystem(seed);
    if (system.planets.length === 0) {
      viewer = new PlanetViewer(viewElement);
      planetPanel.renderEmpty(system);
      controls.planetLabel = '—';
    } else {
      const count = system.planets.length;
      planetIndex = ((planetIndex % count) + count) % count;
      const planet = system.planets[planetIndex];
      // The surface view needs solid ground; envelopes fall back to orbit.
      if (viewMode === 'surface' && !planet.physical.appearance.banding) {
        const surfaceViewer = new SurfaceViewer(viewElement);
        surfaceViewer.setPlanet(system, planet);
        viewer = surfaceViewer;
      } else {
        const planetViewer = new PlanetViewer(viewElement);
        planetViewer.setPlanet(system, planet);
        viewer = planetViewer;
      }
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
  if (viewMode === 'planet' || viewMode === 'surface') {
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
    if (viewMode !== 'planet' && viewMode !== 'surface') return;
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
  viewParam === 'system' || viewParam === 'planet' || viewParam === 'surface'
    ? viewParam
    : 'star';
planetIndex = Number(params.get('planet') ?? 0) || 0;
load(params.get('seed') ?? randomSeedHex());
