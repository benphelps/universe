import { Data3DTexture, DataTexture, FloatType, LinearFilter, NoColorSpace, RedFormat, RGBAFormat } from 'three';
import { gamutMap, xyzToLinearSrgb } from '../../core/color/srgb';
import { spectrumToXyz } from '../../core/color/xyz';
import { C_LIGHT } from '../../core/physics/constants';
import { outflowKey } from '../../universe/galaxy/hotOutflow';
import type { AccretionFlow } from '../../universe/galaxy/accretionFlow';
import { buildHotFlowModel, hotShellSpectrum, HOT_RADIUS_COUNT, sampleHotSpectrum, type HotFlowModel, type HotShellSpectrum, type HotPlasma } from '../../universe/galaxy/hotFlowEmission';

export const HOT_SHIFT_COUNT=64, HOT_LOG_SHIFT_MIN=-6, HOT_LOG_SHIFT_MAX=3;
/** A common camera radiance reference for all hot flows, erg s^-1 cm^-2 sr^-1.
 * This display calibration is fixed, not fitted to each flow's optical peak. */
export const HOT_VISIBLE_REFERENCE=1e11;
export interface HotTables { emission: Float32Array; absorption: Float32Array; model: HotFlowModel; buildMs: number }
export const HOT_RESPONSE_RADII=16, HOT_RESPONSE_SHIFTS=46, HOT_RESPONSE_LAYERS=225;
// Modest local perturbations retain a tractable interpolation error. The
// particle tail has a wider domain because it supplies much of the variability.
export const HOT_RESPONSE_FACTORS=[[.7,1,1.4],[.7,.84,1,1.18,1.4],[.7,.84,1,1.18,1.4],[.3,1,3]] as const;
export interface HotResponseTables { pixels: Float32Array; coolingResponse: Float64Array; shells: HotShellSpectrum[]; buildMs: number }
let responseCache: { base: HotTables; response: HotResponseTables } | undefined;

export function hotGridCoordinate(ratio:number,parameter:number):number {
  const grid=HOT_RESPONSE_FACTORS[parameter];
  for(let i=0;i<grid.length-1;i++)if(ratio<=grid[i+1])
    return Math.max(i,i+Math.log(Math.max(ratio,grid[i])/grid[i])/Math.log(grid[i+1]/grid[i]));
  return grid.length-1;
}

export function receivedSample(shell:HotShellSpectrum,g:number,rgCm:number,powerScale:number):number[] {
  const xyz=spectrumToXyz(nm=>{
    const wavelength=nm*1e-7;
    return g**3*sampleHotSpectrum(shell.emission,C_LIGHT*100/wavelength/g)
      *C_LIGHT*100/wavelength**2*1e-7*rgCm*powerScale/HOT_VISIBLE_REFERENCE;
  });
  const rgb=gamutMap(xyzToLinearSrgb(xyz));
  return [...rgb.map(v=>Math.log2(Math.max(v,1e-30))),
    Math.log2(Math.max(1e-30,sampleHotSpectrum(shell.absorption,C_LIGHT/550e-9/g)*rgCm))];
}

/** Three representative visible bands. This diagonal RGB approximation
 * resolves differential extinction without claiming full spectral transfer. */
export const HOT_ABSORPTION_NM=[610,550,460] as const;
export function receivedAbsorption(shell:HotShellSpectrum,g:number,rgCm:number):number[] {
  return HOT_ABSORPTION_NM.map(nm=>Math.log2(Math.max(1e-30,
    sampleHotSpectrum(shell.absorption,C_LIGHT/(nm*1e-9)/g)*rgCm)));
}

/** Explicit plasma states, with interpolation in radius, received frequency
 * shift and four local parameters. Temperature occupies adjacent 3-D texture
 * slices, so hardware interpolation reduces 16 corners to eight lookups. */
export function buildHotResponseTables(base:HotTables,rgM:number,progress?:(fraction:number)=>void):HotResponseTables {
  if(responseCache?.base===base)return responseCache.response;
  const start=performance.now(), layerSize=HOT_RESPONSE_RADII*HOT_RESPONSE_SHIFTS*4;
  const pixels=new Float32Array(2*layerSize*HOT_RESPONSE_LAYERS);
  const coolingResponse=new Float64Array(HOT_RESPONSE_RADII*HOT_RESPONSE_LAYERS);
  const shells=Array.from({length:HOT_RESPONSE_RADII},(_,r)=>{
    const at=r/(HOT_RESPONSE_RADII-1)*(HOT_RADIUS_COUNT-1),lo=Math.min(HOT_RADIUS_COUNT-2,Math.floor(at)),f=at-lo;
    const a=base.model.shells[lo].plasma,b=base.model.shells[lo+1].plasma,p={...a};
    for(const key of Object.keys(p) as (keyof HotPlasma)[])p[key]=Math.exp(Math.log(a[key])*(1-f)+Math.log(b[key])*f);
    return hotShellSpectrum(p);
  });
  for(let r=0;r<HOT_RESPONSE_RADII;r++) {
    progress?.(r/HOT_RESPONSE_RADII);
    const shell=shells[r];
    for(let n=0;n<3;n++)for(let b=0;b<5;b++)for(let tail=0;tail<3;tail++)for(let t=0;t<5;t++) {
      const p={...shell.plasma};
      p.electronDensityCm3*=HOT_RESPONSE_FACTORS[0][n];
      p.electronTemperatureK*=HOT_RESPONSE_FACTORS[1][t];p.theta*=HOT_RESPONSE_FACTORS[1][t];
      p.magneticGauss*=HOT_RESPONSE_FACTORS[2][b];
      const variant=n===1&&b===2&&tail===1&&t===2?shell:hotShellSpectrum(p,.01*HOT_RESPONSE_FACTORS[3][tail]);
      const layer=((n*5+b)*3+tail)*5+t;
      coolingResponse[r*HOT_RESPONSE_LAYERS+layer]=Math.log(Math.max(variant.escapedPower*base.model.powerScale,1e-100));
      for(let x=0;x<HOT_RESPONSE_SHIFTS;x++) {
        const g=2**(HOT_LOG_SHIFT_MIN+x/(HOT_RESPONSE_SHIFTS-1)*(HOT_LOG_SHIFT_MAX-HOT_LOG_SHIFT_MIN));
        pixels.set(receivedSample(variant,g,rgM*100,base.model.powerScale),2*layer*layerSize+(r*HOT_RESPONSE_SHIFTS+x)*4);
        pixels.set([...receivedAbsorption(variant,g,rgM*100),0],(2*layer+1)*layerSize+(r*HOT_RESPONSE_SHIFTS+x)*4);
      }
    }
  }
  const response={pixels,coolingResponse,shells,buildMs:performance.now()-start};
  responseCache={base,response};return response;
}

/** CPU equivalent of parameter interpolation, shared by the power guard and
 * numerical checks. Values are logarithmic; radius/shift interpolation is
 * applied separately. */
export function interpolateHotParameters(coordinates:ArrayLike<number>,sample:(layer:number)=>number):number {
  let result=0;
  const base=Array.from(coordinates,(x,i)=>Math.min(HOT_RESPONSE_FACTORS[i].length-2,Math.floor(x))),f=Array.from(coordinates,(x,i)=>x-base[i]);
  for(let bits=0;bits<16;bits++) {
    const n=bits&1,t=(bits>>1)&1,b=(bits>>2)&1,tail=(bits>>3)&1;
    const weight=(n?f[0]:1-f[0])*(t?f[1]:1-f[1])*(b?f[2]:1-f[2])*(tail?f[3]:1-f[3]);
    result+=weight*sample((((base[0]+n)*5+base[2]+b)*3+base[3]+tail)*5+base[1]+t);
  }
  return result;
}

/** Allocation-free eight-corner form for the per-frame power estimate. */
export function sampleHotCooling(values:Float64Array,offset:number,coordinates:ArrayLike<number>):number {
  const n0=Math.min(1,Math.floor(coordinates[0])),t0=Math.min(3,Math.floor(coordinates[1]));
  const b0=Math.min(3,Math.floor(coordinates[2])),e0=Math.min(1,Math.floor(coordinates[3]));
  const nf=coordinates[0]-n0,tf=coordinates[1]-t0,bf=coordinates[2]-b0,ef=coordinates[3]-e0;
  let result=0;
  for(let corner=0;corner<8;corner++) {
    const n=corner&1,b=(corner>>1)&1,e=(corner>>2)&1;
    const index=offset+(((n0+n)*5+b0+b)*3+e0+e)*5+t0;
    result+=(n?nf:1-nf)*(b?bf:1-bf)*(e?ef:1-ef)*(values[index]*(1-tf)+values[index+1]*tf);
  }
  return result;
}
let cached: { key: string; tables: HotTables } | undefined;
export function buildHotFlowTables(flow: AccretionFlow, rgM: number): HotTables {
  const key=[rgM,flow.innerRadiusRg,flow.outerRadiusRg,flow.rateKgPerS,flow.eddingtonRatio,flow.aspectRatio,flow.luminosityW,outflowKey(flow)].join(':');
  if(cached?.key===key)return cached.tables;
  const start=performance.now(),model=buildHotFlowModel(flow,rgM);
  const emission=new Float32Array(HOT_RADIUS_COUNT*HOT_SHIFT_COUNT*4),absorption=new Float32Array(HOT_RADIUS_COUNT*HOT_SHIFT_COUNT);
  const rgCm=rgM*100;
  for(let y=0;y<HOT_RADIUS_COUNT;y++)for(let x=0;x<HOT_SHIFT_COUNT;x++) {
    const shell=model.shells[y],g=2**(HOT_LOG_SHIFT_MIN+x/(HOT_SHIFT_COUNT-1)*(HOT_LOG_SHIFT_MAX-HOT_LOG_SHIFT_MIN));
    // I_nu received = g^3 j_nu(nu/g) dl in the emitter frame. Convert the
    // observed wavelength band to frequency before CIE integration.
    const xyz=spectrumToXyz(nm=> {
      const lambdaCm=nm*1e-7,nu=C_LIGHT*100/lambdaCm;
      return g**3*sampleHotSpectrum(shell.emission,nu/g)*(C_LIGHT*100/lambdaCm**2)*1e-7*rgCm*model.powerScale/HOT_VISIBLE_REFERENCE;
    });
    const rgb=gamutMap(xyzToLinearSrgb(xyz)),lum=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
    const index=y*HOT_SHIFT_COUNT+x;
    emission.set(lum>1e-30?[rgb[0]/lum,rgb[1]/lum,rgb[2]/lum,Math.log2(lum)]:[0,0,0,-100],index*4);
    // The scalar transmittance pipeline uses extinction at the band centre.
    absorption[index]=Math.log2(Math.max(1e-30,sampleHotSpectrum(shell.absorption,C_LIGHT/(550e-9)/g)*rgCm));
  }
  const tables={emission,absorption,model,buildMs:performance.now()-start};
  cached={key,tables};return tables;
}

export function createHotFlowSpectrum(flow: AccretionFlow, rgM: number, prepared?:{data:HotTables;response:HotResponseTables}) {
  const data=prepared?.data??buildHotFlowTables(flow,rgM);
  const response=prepared?.response??buildHotResponseTables(data,rgM);
  const local=new Data3DTexture(response.pixels,HOT_RESPONSE_SHIFTS,2*HOT_RESPONSE_RADII,HOT_RESPONSE_LAYERS);
  local.format=RGBAFormat;local.type=FloatType;
  const emission=new DataTexture(data.emission,HOT_SHIFT_COUNT,HOT_RADIUS_COUNT,RGBAFormat,FloatType);
  const absorption=new DataTexture(data.absorption,HOT_SHIFT_COUNT,HOT_RADIUS_COUNT,RedFormat,FloatType);
  for(const texture of [emission,absorption,local]) {
    texture.minFilter=texture.magFilter=LinearFilter;texture.colorSpace=NoColorSpace;texture.needsUpdate=true;
  }
  return {emission,absorption,local,response,data,dispose:()=>{emission.dispose();absorption.dispose();local.dispose();}};
}

export const HOT_FLOW_SPECTRUM_GLSL=/* glsl */ `
vec2 hotSpectrumUv(float r, float g) {
  vec2 at=vec2((log2(max(g,0.015625))-(${HOT_LOG_SHIFT_MIN}.0))/${HOT_LOG_SHIFT_MAX-HOT_LOG_SHIFT_MIN}.0,
    log(r/uInnerRenderRg)/log(uOuterRg/uInnerRenderRg));
  return (vec2(0.5)+clamp(at,0.0,1.0)*vec2(${HOT_SHIFT_COUNT-1}.0,${HOT_RADIUS_COUNT-1}.0))
    /vec2(${HOT_SHIFT_COUNT}.0,${HOT_RADIUS_COUNT}.0);
}
vec4 hotFlowLight(float r,float g) {
  if(g<0.015625)return vec4(0.0);
  vec2 uv=hotSpectrumUv(r,g);
  vec4 sampleLight=texture2D(uHotEmission,uv);
  return vec4(sampleLight.rgb*exp2(sampleLight.a),exp2(texture2D(uHotAbsorption,uv).r));
}

vec4 localHotFlowComponentLog(float r,float g,vec4 state,float component) {
  vec2 at=clamp(vec2((log2(g)-(${HOT_LOG_SHIFT_MIN}.0))/${HOT_LOG_SHIFT_MAX-HOT_LOG_SHIFT_MIN}.0,
    log(r/uInnerRenderRg)/log(uOuterRg/uInnerRenderRg)),0.0,1.0);
  vec2 uv=(vec2(.5,.5+component*${HOT_RESPONSE_RADII}.0)+at*vec2(${HOT_RESPONSE_SHIFTS-1}.0,${HOT_RESPONSE_RADII-1}.0))
    /vec2(${HOT_RESPONSE_SHIFTS}.0,${2*HOT_RESPONSE_RADII}.0);
  vec4 lower=min(floor(state),vec4(1.0,3.0,3.0,1.0)),f=state-lower;
  vec4 light=vec4(0.0);
  for(int corner=0;corner<8;corner++) {
    float n=float(corner&1),b=float((corner>>1)&1),tail=float((corner>>2)&1);
    float weight=mix(1.0-f.x,f.x,n)*mix(1.0-f.z,f.z,b)*mix(1.0-f.w,f.w,tail);
    float group=((lower.x+n)*5.0+lower.z+b)*3.0+lower.w+tail;
    light+=weight*texture(uHotLocal,vec3(uv,(group*5.0+.5+state.y)/${HOT_RESPONSE_LAYERS}.0));
  }
  return clamp(light,vec4(-100.0),vec4(40.0));
}
vec4 localHotFlowLog(float r,float g,vec4 state) {return localHotFlowComponentLog(r,g,state,0.0);}
vec3 localHotAbsorption(float r,float g,vec4 state) {
  if(g<0.015625)return vec3(0.0);
  return exp2(localHotFlowComponentLog(r,g,state,1.0).rgb);
}
vec4 localHotFlowLight(float r,float g,vec4 state) {
  if(g<0.015625)return vec4(0.0);
  return exp2(localHotFlowLog(r,g,state));
}
`;
