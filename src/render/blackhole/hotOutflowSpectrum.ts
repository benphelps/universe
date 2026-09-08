import { DataTexture, Data3DTexture, FloatType, LinearFilter, NoColorSpace, RGBAFormat } from 'three';
import type { AccretionFlow } from '../../universe/galaxy/accretionFlow';
import { hotShellSpectrum } from '../../universe/galaxy/hotFlowEmission';
import { outflowAt, outflowPlasma, JET_WIDTH, type OutflowKind } from '../../universe/galaxy/hotOutflowEmission';
import { hotInflowRate, outflowKey } from '../../universe/galaxy/hotOutflow';
import { HOT_LOG_SHIFT_MIN, HOT_LOG_SHIFT_MAX, receivedSample, receivedAbsorption } from './hotFlowSpectrum';

export const OUTFLOW_RADII=24, OUTFLOW_ANGLES=20, OUTFLOW_SHIFTS=46;
export interface OutflowTable { pixels:Float32Array; powerScale:number; emittedW:number; budgetW:number; launch:number }
export interface OutflowTables { wind:OutflowTable;jet:OutflowTable;buildMs:number }
let cached:(OutflowTables & {key:string})|undefined;
export function buildOutflowTable(flow:AccretionFlow,rgM:number,kind:OutflowKind,temperatureScale:number,progress?:(fraction:number)=>void):OutflowTable {
  const p=flow.outflows,launch=p?(kind==='jet'?p.jetLaunchRg:p.windLaunchRg):flow.outerRadiusRg;
  const pixels=new Float32Array(OUTFLOW_SHIFTS*OUTFLOW_RADII*OUTFLOW_ANGLES*4*2);
  const budgetW=outflowAt(flow,kind,flow.outerRadiusRg).electronW;
  if(!(budgetW>0))return {pixels,powerScale:1,emittedW:0,budgetW:0,launch};
  const dlog=Math.log(flow.outerRadiusRg/launch)/(OUTFLOW_RADII-1);
  const angularStep=(kind==='jet'?9*JET_WIDTH:1)/(OUTFLOW_ANGLES-1);
  let emittedW=0;
  for(let m=0;m<OUTFLOW_ANGLES;m++)for(let r=0;r<OUTFLOW_RADII;r++) {
    if(r===0)progress?.(m/OUTFLOW_ANGLES);
    const radius=launch*Math.exp(r*dlog),mu=kind==='jet'?1-9*JET_WIDTH*m/(OUTFLOW_ANGLES-1):m/(OUTFLOW_ANGLES-1);
    const plasma=outflowPlasma(flow,rgM,kind,radius,mu,temperatureScale);
    if(!plasma)continue;
    const shell=hotShellSpectrum(plasma,kind==='jet'?.03:.01);
    const edge=(m===0||m===OUTFLOW_ANGLES-1?.5:1)*(r===0||r===OUTFLOW_RADII-1?.5:1);
    emittedW+=shell.emittedPower*4*Math.PI*plasma.radiusCm**3*dlog*angularStep*edge/1e7;
    for(let x=0;x<OUTFLOW_SHIFTS;x++) {
      const g=2**(HOT_LOG_SHIFT_MIN+x/(OUTFLOW_SHIFTS-1)*(HOT_LOG_SHIFT_MAX-HOT_LOG_SHIFT_MIN));
      const sample=receivedSample(shell,g,rgM*100,1).map(v=>2**v);
      sample[3]+=plasma.electronDensityCm3*6.6524587e-25*rgM*100;
      pixels.set(sample,((m*OUTFLOW_RADII+r)*OUTFLOW_SHIFTS+x)*4);
      const extinction=receivedAbsorption(shell,g,rgM*100).map(v=>2**v+plasma.electronDensityCm3*6.6524587e-25*rgM*100);
      pixels.set([...extinction,0],(((m+OUTFLOW_ANGLES)*OUTFLOW_RADII+r)*OUTFLOW_SHIFTS+x)*4);
    }
  }
  // Conservative local emitted-power ceiling (even reabsorbed photons count).
  // This can under-radiate the electron budget; it never boosts a faint jet.
  const powerScale=Math.min(1,budgetW/Math.max(emittedW,1e-100));
  for(let i=0;i<pixels.length/2;i+=4)for(let c=0;c<3;c++)pixels[i+c]*=powerScale;
  return {pixels,powerScale,emittedW:emittedW*powerScale,budgetW,launch};
}
/** Smooth steady kinematics are independent of ray direction and time. */
export function outflowKinematics(flow:AccretionFlow):Float32Array {
  const pixels=new Float32Array(256*4);
  for(let i=0;i<256;i++) {
    const r=flow.innerRadiusRg*(flow.outerRadiusRg/flow.innerRadiusRg)**(i/255);
    pixels.set([outflowAt(flow,'wind',r).beta,outflowAt(flow,'jet',r).beta,
      hotInflowRate(flow,r)/Math.max(flow.rateKgPerS,1e-100),0],i*4);
  }
  return pixels;
}
export function buildOutflowTables(flow:AccretionFlow,rgM:number,temperatureScale:number,progress?:(fraction:number)=>void):OutflowTables {
  const key=[rgM,flow.rateKgPerS,flow.eddingtonRatio,flow.outerRadiusRg,temperatureScale,outflowKey(flow)].join(':');
  if(cached?.key!==key) {
    const start=performance.now();
    cached={key,wind:buildOutflowTable(flow,rgM,'wind',temperatureScale,f=>progress?.(f/2)),jet:buildOutflowTable(flow,rgM,'jet',temperatureScale,f=>progress?.(.5+f/2)),buildMs:performance.now()-start};
  }
  return cached;
}
export function createHotOutflowSpectrum(flow:AccretionFlow,rgM:number,temperatureScale:number,prepared?:OutflowTables) {
  const data=prepared??buildOutflowTables(flow,rgM,temperatureScale);
  const texture=(pixels:Float32Array)=>{
    const t=new Data3DTexture(pixels,OUTFLOW_SHIFTS,OUTFLOW_RADII,2*OUTFLOW_ANGLES);
    t.format=RGBAFormat;t.type=FloatType;t.minFilter=t.magFilter=LinearFilter;t.colorSpace=NoColorSpace;t.needsUpdate=true;return t;
  };
  const wind=texture(data.wind.pixels),jet=texture(data.jet.pixels);
  const kinematics=new DataTexture(outflowKinematics(flow),256,1,RGBAFormat,FloatType);
  kinematics.minFilter=kinematics.magFilter=LinearFilter;kinematics.colorSpace=NoColorSpace;kinematics.needsUpdate=true;
  return {wind,jet,kinematics,data,dispose:()=>{wind.dispose();jet.dispose();kinematics.dispose();}};
}
export const HOT_OUTFLOW_GLSL=/* glsl */ `
vec3 outflowKinematicsAt(float radialNorm) {
  if(uWindEnabled<.5 && uJetEnabled<.5)return vec3(0.0,0.0,1.0);
  return texture2D(uOutflowKinematics,vec2((.5+clamp(radialNorm,0.0,1.0)*255.0)/256.0,.5)).rgb;
}
// The photon contraction with radial ZAMO motion, factored into a shared
// geometric part and the medium's speed. u^phi includes frame dragging.
vec2 outflowContraction(float r,float mu,float a,float xi,float dr) {
  float sigma=kerrSigma(r,mu,a),delta=kerrDelta(r,a),bigA=kerrBigA(r,mu,a);
  return vec2(sqrt(bigA/(sigma*delta))*(1.0-xi*2.0*a*r/bigA),dr/sqrt(delta*sigma));
}
float outflowShift(vec2 contraction,float beta) {
  float received=contraction.x-beta*contraction.y;
  return received>0.0?sqrt(1.0-beta*beta)/received:0.0;
}
vec4 outflowComponent(sampler3D table,float launch,float r,float angular,float g,float component) {
  if(r<=launch||g<.015625)return vec4(0.0);
  vec3 at=clamp(vec3((log2(g)+6.0)/9.0,log(r/launch)/log(uOuterRg/launch),angular),0.0,1.0);
  return texture(table,(vec3(.5,.5,.5+component*${OUTFLOW_ANGLES}.0)+at*vec3(${OUTFLOW_SHIFTS-1}.0,${OUTFLOW_RADII-1}.0,${OUTFLOW_ANGLES-1}.0))
    /vec3(${OUTFLOW_SHIFTS}.0,${OUTFLOW_RADII}.0,${2*OUTFLOW_ANGLES}.0));
}
vec4 outflowLight(sampler3D table,float launch,float r,float angular,float g) {return outflowComponent(table,launch,r,angular,g,0.0);}
vec3 outflowExtinction(sampler3D table,float launch,float r,float angular,float g) {return outflowComponent(table,launch,r,angular,g,1.0).rgb;}
`;
