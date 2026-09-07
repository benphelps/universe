import { FIELD_SELECTION_DATA } from './fieldSelectionData';
import { CATALOG_ROWS, taperKeep } from './catalog';
import { AGE_BIT_SPAN } from '../star/identity';
import { fieldPopulationMoments } from './fieldPopulation';
import { FIELD_COMPONENTS, FIELD_ROW_BOUNDS, SELECTION_AGE_BINS, SELECTION_POWER_BINS, selectionAgeIndex, selectionPowerIndex } from './fieldSelectionGrid';
import { MIN_FAR_IRRADIANCE } from './skySurvey';

export const SELECTION_WIDTH = SELECTION_POWER_BINS+1;
export const SELECTION_HEIGHT = (SELECTION_AGE_BINS+1)*16;
let data: Float32Array | undefined;
/** Only sky-building workers load the CDF, never star generation. */
export function fieldSelectionData(): Float32Array {
  if (!data) {
    const bytes=Uint8Array.from(atob(FIELD_SELECTION_DATA),c=>c.charCodeAt(0));
    const view=new DataView(bytes.buffer);
    data=new Float32Array(bytes.length/4);
    for(let i=0;i<data.length;i++)data[i]=view.getFloat32(i*4,true);
  }
  return data;
}
function sampleRgb(component:number,row:number,a:number,p:number): [number,number,number] {
  const table=fieldSelectionData();
  const a0=Math.floor(a),a1=Math.min(SELECTION_AGE_BINS,a0+1),p0=Math.floor(p),p1=Math.min(SELECTION_POWER_BINS,p0+1);
  const base=(component*4+row)*(SELECTION_AGE_BINS+1);
  const at=[((base+a0)*SELECTION_WIDTH+p0)*3,((base+a0)*SELECTION_WIDTH+p1)*3,((base+a1)*SELECTION_WIDTH+p0)*3,((base+a1)*SELECTION_WIDTH+p1)*3];
  const x=p-p0,y=a-a0;
  const weights=[(1-x)*(1-y),x*(1-y),(1-x)*y,x*y];
  const rgb:[number,number,number]=[0,0,0];
  for(let i=0;i<4;i++)for(let c=0;c<3;c++)rgb[c]+=table[at[i]+c]*weights[i];
  return rgb;
}
let fullRows: number[][][] | undefined;
function fullRowMoments(): number[][][] {
  return fullRows ??= FIELD_COMPONENTS.map((_,component)=>Array.from({length:4},(_,row)=>sampleRgb(component,row,SELECTION_AGE_BINS,SELECTION_POWER_BINS)));
}
export function fieldSelectionRows(): {cap:number; youngPc:number; oldPc:number}[] {
  return FIELD_ROW_BOUNDS.slice(0,4).map(m=>{
    const rows=CATALOG_ROWS.filter(r=>r.massLo===m),young=rows[0];
    return {cap:young.ageBitsHi/AGE_BIT_SPAN,youngPc:young.skyRadiusPc,oldPc:rows[1]?.skyRadiusPc ?? young.skyRadiusPc};
  });
}
/** The tiny correction ties the finite joint quadrature to independently
 * converged additive moments. Audit its size; it must not be tuned for
 * display or used to conceal unconverged companion/phase sampling. */
export function fieldSelectionScales(): number[][] {
  return FIELD_COMPONENTS.map((component,i)=>[0,1,2].map(c=>{
    let full=0;for(let row=0;row<4;row++)full+=fullRowMoments()[i][row][c];
    return fieldPopulationMoments(component).opticalRgbSolar[c]/full;
  }));
}
let scales: number[][] | undefined;
let cachedRows: ReturnType<typeof fieldSelectionRows> | undefined;
let maximumReach=0;

/** Expected selected optical RGB per pc³ at a ray sample. The census
 * and row reach share one position hash, hence min(keep), not their
 * product. Age-bit row cuts are mapped through the local component mix.
 * Poisson realization fluctuations remain in the actual points. */
export function selectedFieldEmission(counts:readonly number[],distancePc:number,nearPc:number): [number,number,number] {
  const sum=counts.reduce((a,b)=>a+b,0),selected:[number,number,number]=[0,0,0];
  if(!(sum>0))return selected;
  if(!cachedRows) { cachedRows=fieldSelectionRows();maximumReach=Math.max(...cachedRows.flatMap(r=>[r.youngPc*1.5,r.oldPc*1.5])); }
  const rows=cachedRows;
  if(distancePc>=Math.max(nearPc*2,maximumReach))return selected;
  const correction=scales ??=fieldSelectionScales();
  const census=taperKeep({innerPc:nearPc,outerPc:nearPc*2},distancePc);
  const p=selectionPowerIndex(MIN_FAR_IRRADIANCE*distancePc*distancePc);
  let prior=0;
  for(let component=0;component<4;component++) {
    const share=counts[component]/sum;
    if(!(share>0))continue;
    for(let row=0;row<4;row++) {
      const spec=rows[row];
      const keep=(pc:number)=>pc>0?taperKeep({innerPc:pc,outerPc:1.5*pc},distancePc):census;
      const young=keep(spec.youngPc),old=keep(spec.oldPc);
      if(young<=0&&old<=0)continue;
      const yc=Math.min(census,young),oc=Math.min(census,old);
      const age=Math.max(0,Math.min(1,(spec.cap-prior)/share));
      const full=fullRowMoments()[component][row];
      const allFaint=sampleRgb(component,row,SELECTION_AGE_BINS,p);
      const ai=selectionAgeIndex(age);
      const youngFull=age>=1?full:sampleRgb(component,row,ai,SELECTION_POWER_BINS);
      const youngFaint=age>=1?allFaint:sampleRgb(component,row,ai,p);
      for(let c=0;c<3;c++) {
        const bright=Math.max(0,full[c]-allFaint[c]);
        const youngBright=Math.max(0,youngFull[c]-youngFaint[c]);
        const value=full[c]*oc+youngFull[c]*(yc-oc)+bright*(old-oc)+youngBright*(young-yc-old+oc);
        selected[c]+=counts[component]*correction[component][c]*Math.max(0,Math.min(full[c],value));
      }
    }
    prior+=share;
  }
  return selected;
}
