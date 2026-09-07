import { loadingWorkSpans } from './loadingWorkAudit';
import { skyLoadingAuditText } from './skyLoadingAudit';
import type { PerfStats } from './ui/perfReadout';
import { generationSchedulerLoad } from './generationScheduler';
import { nebulaBakeAuditText } from './nebulaBakeAudit';

/** Hold content fixed for a matched rendering comparison. Audit mode only. */
export function performanceVolumeLimit(): number | null {
  if (typeof location === 'undefined') return null;
  const query = new URLSearchParams(location.search);
  if (!query.has('benchmark')) return null;
  const value = Number(query.get('benchmarkVolumes'));
  return Number.isInteger(value) && value >= 1 && value <= 64 ? value : null;
}

/** Fix render dimensions when the surrounding app panel changes width. */
export function performanceViewport(): [number, number] | null {
  if (typeof location === 'undefined') return null;
  const query = new URLSearchParams(location.search);
  if (!query.has('benchmark')) return null;
  const values = (query.get('benchmarkViewport') ?? '').split('x').map(Number);
  return values.length === 2 && values.every(value => Number.isInteger(value) && value >= 320 && value <= 4096)
    ? values as [number, number] : null;
}

/** Explicit audit mode only. Ordinary frames allocate no recorder or samples.
 * The result is visible DOM so browser checks can read the same evidence as
 * a person. Raw frame intervals include hitches; hidden samples are rejected. */
type CaptureFrame = (intervalMs: number, stats: PerfStats) => void;
export type PerformanceSwitch = 'bloom' | 'volumes' | 'backdrop' | 'stars' | 'culling' | 'patches' | 'volumeCulling' | 'adaptiveSampling' | 'terrainLod' | 'seasonalSnow' | 'groundSky' | 'limb' | 'clouds' | 'depthGlobe';
export type PerformanceNavigation = 'orbit' | 'tilt' | 'closer' | 'farther' | 'core-crossing' | 'ground-flight' | 'season-zero' | 'season-quarter' | 'season-half' | 'season-three-quarter';
export function createPerformanceCapture(onToggle: (key: PerformanceSwitch, enabled: boolean) => void,
  onNavigate: (action: PerformanceNavigation) => void):
  (CaptureFrame & { enabled: Record<PerformanceSwitch, boolean>; dispose: () => void }) | null {
  if (typeof location === 'undefined' || !new URLSearchParams(location.search).has('benchmark')) return null;
  const panel = document.createElement('details');
  panel.style.cssText = 'position:fixed;bottom:56px;right:12px;z-index:1000;width:520px;max-width:calc(100vw - 44px);background:#10161fee;color:white;padding:10px;font:12px monospace';
  const summary = document.createElement('summary'); summary.textContent = 'Performance capture';
  // Keep controls stationary while the loading milestones grow beneath them.
  const body = document.createElement('div'); body.style.cssText = 'height:60vh;overflow:auto';
  const button = document.createElement('button'); button.textContent = 'Record 20 seconds';
  const output = document.createElement('pre'); output.id = 'performance-capture'; output.style.whiteSpace = 'pre-wrap';
  const loading = document.createElement('pre'); loading.id = 'sky-loading-capture'; loading.style.whiteSpace = 'pre-wrap';
  const bakes = document.createElement('pre'); bakes.id = 'nebula-bake-capture'; bakes.style.whiteSpace = 'pre-wrap';
  body.append(button,output,loading,bakes); panel.append(summary,body); document.body.append(panel); panel.open = true;
  // Reproducible camera-motion probes use the same orbit/ride path as gestures.
  const navigation = { orbit: 'Orbit 90°', tilt: 'Tilt 30°', closer: 'Ride closer ×2', farther: 'Ride farther ×2',
    'core-crossing': 'Record center crossing', 'ground-flight': 'Record ground flight', 'season-zero':'Season 0%', 'season-quarter':'Season 25%', 'season-half':'Season 50%', 'season-three-quarter':'Season 75%' };
  for (const action of Object.keys(navigation) as PerformanceNavigation[]) {
    const control = document.createElement('button'); control.textContent = navigation[action];
    control.onclick = () => { if (action === 'core-crossing' || action === 'ground-flight') button.click(); onNavigate(action); }; body.insertBefore(control, output);
  }
  const enabled = { bloom: true, volumes: true, backdrop: true, stars: true, culling: true, patches: true, volumeCulling: true, adaptiveSampling: true, terrainLod: true, seasonalSnow: true, groundSky: true, limb: true, clouds: true, depthGlobe: true };
  const labels = { bloom: 'Render bloom', volumes: 'Render volume layer', backdrop: 'Render sky backdrop', stars: 'Render star points', culling: 'Cull offscreen star points', patches: 'Cull offscreen sky patches', volumeCulling: 'Cull offscreen volume domes', adaptiveSampling: 'Adaptive volume sampling', terrainLod: 'Distance-selected orbital terrain', seasonalSnow: 'Seasonal snow overlay', groundSky: 'Render ground sky', limb: 'Render atmosphere limb', clouds: 'Render planetary clouds', depthGlobe: 'Render depth globe' };
  for (const key of Object.keys(labels) as PerformanceSwitch[]) {
    const label = document.createElement('label'); label.style.display = 'block';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = enabled[key];
    checkbox.onchange = () => {
      enabled[key] = checkbox.checked; onToggle(key, checkbox.checked);
      if (started) { started = 0; button.disabled = false; output.textContent = 'Capture cancelled: render configuration changed.'; }
    };
    label.append(checkbox, labels[key]); body.insertBefore(label, output);
  }
  let started = 0;
  let samples: Array<{atMs:number;intervalMs:number;gpuMs:number|null;scriptMs:number;bakes:number;volumes:number;volumeCap:number;skyPixelPitch:number;draws:number;triangles:number;terrain:number;active:number;queued:number;resources?:PerfStats['resources'];pose?:PerfStats['pose']}> = [];
  const distribution = (values:number[]) => {
    const sorted=[...values].sort((a,b)=>a-b),pick=(q:number)=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))]??null;
    return {count:values.length,mean:values.reduce((a,b)=>a+b,0)/(values.length||1),p50:pick(.5),p95:pick(.95),p99:pick(.99),max:pick(1)};
  };
  button.onclick = () => { samples=[]; started=performance.now(); button.disabled=true; output.textContent='Recording…'; };
  let lastLoading = '';
  let lastBakes = '';
  const capture: CaptureFrame = (intervalMs,stats) => {
    const nextLoading = skyLoadingAuditText();
    if (nextLoading !== lastLoading) { loading.textContent = nextLoading; lastLoading = nextLoading; }
    const nextBakes = nebulaBakeAuditText();
    if (nextBakes !== lastBakes) { bakes.textContent = nextBakes; lastBakes = nextBakes; }
    if (!started) return;
    if (document.visibilityState !== 'visible') { started=0;button.disabled=false;output.textContent='Capture cancelled: tab became hidden.';return; }
    const load=generationSchedulerLoad();
    samples.push({atMs:performance.now(),intervalMs,gpuMs:stats.gpuMs,scriptMs:stats.scriptMs,bakes:stats.bakes,volumes:stats.volumes,volumeCap:stats.volumeCap,skyPixelPitch:stats.skyPixelPitch??1.4,draws:stats.drawCalls,triangles:stats.triangles,terrain:stats.terrain,active:load.active,queued:load.queued,resources:stats.resources,pose:stats.pose});
    if(performance.now()-started<20000 && samples.length<10000)return;
    const durationMs=performance.now()-started;started=0;button.disabled=false;
    const canvas=document.querySelector('canvas');
    output.textContent=JSON.stringify({url:location.href,userAgent:navigator.userAgent,cores:navigator.hardwareConcurrency,
      viewport:[innerWidth,innerHeight],canvasCss:canvas?[canvas.clientWidth,canvas.clientHeight]:null,buffer:canvas?[canvas.width,canvas.height]:null,devicePixelRatio,
      durationMs,work:loadingWorkSpans(),frames:samples.length,averageFps:1000*samples.length/durationMs,
      intervalMs:distribution(samples.map(s=>s.intervalMs)),gpuMs:distribution(samples.flatMap(s=>s.gpuMs===null?[]:[s.gpuMs])),
      scriptMs:distribution(samples.map(s=>s.scriptMs)),over20ms:samples.filter(s=>s.intervalMs>20).length,
      over50ms:samples.filter(s=>s.intervalMs>50).length,enabled:{...enabled},first:samples[0],last:samples.at(-1),samples},null,2);
  };
  return Object.assign(capture, { enabled, dispose: () => { started = 0; samples = []; button.onclick = null; panel.remove(); } });
}
