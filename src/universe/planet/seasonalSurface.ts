import { seasonalPointCycle, type SeasonalCycle } from './seasonalClimate';

export interface SeasonalSurfaceField {
  /** Uniform colatitudes including both exact poles; time-major rows. */
  latitudeCount: number;
  frameCount: number;
  temperatureK: Float32Array;
  cycleSeconds: number;
  diagnostics: { pointSolves: number; maximumProbeErrorK: number; toleranceK: number };
}
export type SeasonalSurfaceResult = { status: 'ready'; field: SeasonalSurfaceField }
  | { status: 'unavailable'; reason: 'spin-resolved' | 'resolution-budget' | 'not-converged' };

/** Worker-only visual field from the actual point solutions. Preserve every
 * integration time step; refine latitude by the worst error across the entire
 * cycle, including exact poles. Midpoint probing is a measured interpolation
 * criterion, not a rigorous continuum bound. Unsupported/budget-exhausted
 * worlds keep their annual appearance, never a partially prepared map. */
export function buildSeasonalSurface(cycle: SeasonalCycle,
  options: { toleranceK?: number; maxIntervals?: number } = {}): SeasonalSurfaceResult {
  if (cycle.mode !== 'rotation-averaged') return { status: 'unavailable', reason: 'spin-resolved' };
  const toleranceK = options.toleranceK ?? .35, maxIntervals = options.maxIntervals ?? 256;
  if (!(toleranceK > 0) || !Number.isFinite(toleranceK) || ![16,32,64,128,256].includes(maxIntervals)) throw new RangeError('Invalid seasonal surface budget');
  const profiles = new Map<number, Float64Array>();
  let failed = false;
  const point = (index: number) => {
    let p = profiles.get(index);
    if (!p) {
      const angle = Math.PI * index / (2 * maxIntervals);
      const solved = seasonalPointCycle(cycle, {x:Math.sin(angle),y:Math.cos(angle),z:0});
      if (!solved) { failed = true; return new Float64Array(cycle.diagnostics.steps); }
      p = solved.temperatureK; profiles.set(index,p);
    }
    return p;
  };
  for (let intervals = 16; intervals <= maxIntervals; intervals *= 2) {
    const stride = 2 * maxIntervals / intervals;
    let error = 0;
    for (let j=0;j<intervals;j++) {
      const a=point(j*stride),b=point((j+1)*stride),mid=point((j+.5)*stride);
      for(let k=0;k<a.length;k++) error=Math.max(error,Math.abs(mid[k]-(a[k]+b[k])*.5));
    }
    if (failed) return {status:'unavailable',reason:'not-converged'};
    if (error > toleranceK) continue;
    const latitudeCount=intervals+1,frameCount=cycle.diagnostics.steps,temperatureK=new Float32Array(latitudeCount*frameCount);
    for(let j=0;j<latitudeCount;j++) {
      const profile=point(j*stride);
      for(let k=0;k<frameCount;k++)temperatureK[k*latitudeCount+j]=profile[k];
    }
    return {status:'ready',field:{latitudeCount,frameCount,temperatureK,cycleSeconds:cycle.cycleSeconds,
      diagnostics:{pointSolves:profiles.size,maximumProbeErrorK:error,toleranceK}}};
  }
  return {status:'unavailable',reason:'resolution-budget'};
}

/** CPU mirror of the texture's bilinear lookup, for independent probes. */
export function seasonalSurfaceTemperatureAt(field: SeasonalSurfaceField, y: number, seconds: number): number {
  const x=Math.acos(Math.max(-1,Math.min(1,y)))/Math.PI*(field.latitudeCount-1),j=Math.min(field.latitudeCount-2,Math.floor(x)),fx=x-j;
  const phase=((seconds/field.cycleSeconds)%1+1)%1*field.frameCount,k=Math.floor(phase),ft=phase-k;
  const row=(t:number)=>field.temperatureK[t*field.latitudeCount+j]*(1-fx)+field.temperatureK[t*field.latitudeCount+j+1]*fx;
  return row(k)*(1-ft)+row((k+1)%field.frameCount)*ft;
}
