import type { AccretionFlow } from '../../universe/galaxy/accretionFlow';
import { buildHotFlowTables, buildHotResponseTables, type HotTables, type HotResponseTables } from './hotFlowSpectrum';
import { buildOutflowTables, type OutflowTables } from './hotOutflowSpectrum';
import { flowNoisePixels } from './flowNoise';

export interface BlackHoleBuildProgress { fraction:number; stage:string }
export interface BlackHoleTables {
  hot?:{data:HotTables;response:HotResponseTables;outflows?:OutflowTables};
  noise?:Uint8Array;
}
/** CPU-only entry point. Production calls this inside a worker; texture and
 * shader objects are constructed on the main thread after data arrives. */
export function buildBlackHoleTables(flow:AccretionFlow,rgM:number,progress:(p:BlackHoleBuildProgress)=>void=()=>{}):BlackHoleTables {
  if(flow.eddingtonRatio<=1e-10)return {};
  if(flow.regime!=='riaf') {
    progress({fraction:0,stage:'disk structure'});
    return {noise:flowNoisePixels()};
  }
  progress({fraction:.01,stage:'plasma equilibrium'});
  const data=buildHotFlowTables(flow,rgM);
  const response=buildHotResponseTables(data,rgM,f=>progress({fraction:.1+.7*f,stage:'plasma spectra'}));
  const outflows=flow.outflows?buildOutflowTables(flow,rgM,data.model.electronTemperatureScale,
    f=>progress({fraction:.8+.19*f,stage:f<.5?'wind spectra':'jet spectra'})):undefined;
  return {hot:{data,response,outflows}};
}
/** Transfer each typed buffer exactly once, including nested reference spectra. */
export function blackHoleTableTransfers(data:BlackHoleTables):ArrayBuffer[] {
  const found=new Set<ArrayBuffer>();
  const visit=(value:unknown):void=>{
    if(ArrayBuffer.isView(value)){found.add(value.buffer as ArrayBuffer);return;}
    if(value && typeof value==='object')for(const child of Object.values(value))visit(child);
  };
  visit(data);return [...found];
}
