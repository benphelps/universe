import type { AccretionFlow } from '../../universe/galaxy/accretionFlow';
import { THOMSON_CROSS_SECTION } from '../../core/physics/constants';
import { HOT_LOG_SHIFT_MIN, HOT_LOG_SHIFT_MAX, HOT_SHIFT_COUNT, type HotTables } from './hotFlowSpectrum';

export const DEFAULT_CORE_EXPOSURE = .08;

/** A camera preset from the already-built reference spectrum. Estimate the
 * brightest vertical column outside 3 rg at g=1; leave faint cores alone.
 * This meters the image, not the plasma: one exposure applies to all light.
 * Fixed at material readiness so turbulence and orbiting cannot cause pumping.
 */
export function coreExposureFor(flow:AccretionFlow,rgM:number,data?:HotTables):number {
  if(!data)return DEFAULT_CORE_EXPOSURE;
  const at=-HOT_LOG_SHIFT_MIN/(HOT_LOG_SHIFT_MAX-HOT_LOG_SHIFT_MIN)*(HOT_SHIFT_COUNT-1);
  const lo=Math.floor(at),f=at-lo;
  let peak=0;
  for(let row=0;row<data.model.shells.length;row++) {
    const plasma=data.model.shells[row].plasma,r=plasma.radiusCm/(rgM*100);
    if(r<3 || r>flow.outerRadiusRg*.8)continue;
    const index=row*HOT_SHIFT_COUNT+lo;
    const emission=2**(data.emission[index*4+3]*(1-f)+data.emission[(index+1)*4+3]*f);
    const absorption=2**(data.absorption[index]*(1-f)+data.absorption[index+1]*f);
    const column=Math.sqrt(Math.PI)*flow.aspectRatio*r;
    const tau=absorption*column+plasma.electronDensityCm3*THOMSON_CROSS_SECTION*1e4*rgM*100*Math.SQRT2*column;
    const escape=tau>1e-5?-Math.expm1(-tau)/tau:1;
    peak=Math.max(peak,emission*column*escape);
  }
  return Number.isFinite(peak)?Math.max(1e-8,Math.min(DEFAULT_CORE_EXPOSURE,.6/Math.max(peak,1e-30))):DEFAULT_CORE_EXPOSURE;
}
