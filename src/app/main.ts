import './style.css';
import { seedFromHex, seedToHex } from '../core/rng/hash';
import { generateStar } from '../universe/star/generate';
import { generateSystem } from '../universe/system/generate';
import { Controls, type ViewMode } from './ui/controls';
import { InfoPanel } from './ui/infoPanel';
import { SystemInfoPanel } from './ui/systemInfoPanel';
import { StarViewer } from './viewer';
import { SystemViewer } from './systemViewer';

const viewElement = document.getElementById('view')!;
const infoElement = document.getElementById('info')!;
const starPanel = new InfoPanel(infoElement);
const systemPanel = new SystemInfoPanel(infoElement);

let viewMode: ViewMode = 'star';
let seedHex = '';
let viewer: StarViewer | SystemViewer | null = null;
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
  } else {
    const system = generateSystem(seed);
    const systemViewer = new SystemViewer(viewElement);
    systemViewer.setSystem(system);
    systemPanel.render(system);
    viewer = systemViewer;
  }
  viewer.exposure = exposure;
  if (timeScale !== null) viewer.timeScaleDaysPerSecond = timeScale;

  controls.seed = seedHex;
  controls.view = viewMode;
  const url = new URL(location.href);
  url.searchParams.set('seed', seedHex);
  url.searchParams.set('view', viewMode);
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
viewMode = params.get('view') === 'system' ? 'system' : 'star';
load(params.get('seed') ?? randomSeedHex());
