import './style.css';
import { seedFromHex, seedToHex } from '../core/rng/hash';
import { generateStar } from '../universe/star/generate';
import { Controls } from './ui/controls';
import { InfoPanel } from './ui/infoPanel';
import { StarViewer } from './viewer';

const viewer = new StarViewer(document.getElementById('view')!);
const infoPanel = new InfoPanel(document.getElementById('info')!);

function randomSeedHex(): string {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return words[0].toString(16).padStart(8, '0') + words[1].toString(16).padStart(8, '0');
}

function load(seedHex: string): void {
  const star = generateStar(seedFromHex(seedHex));
  viewer.setStar(star);
  infoPanel.render(star);
  controls.seed = seedToHex(seedFromHex(seedHex));
  const url = new URL(location.href);
  url.searchParams.set('seed', seedHex);
  history.replaceState(null, '', url);
}

const controls = new Controls(document.getElementById('controls')!, {
  onSeed: load,
  onRandom: () => load(randomSeedHex()),
  onTimeScale: (daysPerSecond) => {
    viewer.timeScaleDaysPerSecond = daysPerSecond;
  },
  onExposure: (exposure) => {
    viewer.exposure = exposure;
  },
});

load(new URLSearchParams(location.search).get('seed') ?? randomSeedHex());
