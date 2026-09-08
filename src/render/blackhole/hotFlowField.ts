import { DataTexture, FloatType, LinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat } from 'three';
import type { AccretionFlow } from '../../universe/galaxy/accretionFlow';
import { HotFlowDynamics, HOT_FIELD_AZIMUTHS, HOT_FIELD_RADII } from '../../universe/galaxy/hotFlowDynamics';
import type { HotFlowModel } from '../../universe/galaxy/hotFlowEmission';
import { hotGridCoordinate,sampleHotCooling,HOT_RESPONSE_LAYERS,HOT_RESPONSE_RADII,type HotResponseTables } from './hotFlowSpectrum';

/** Compression of relativistic electrons and an isotropic tangled field:
 * T∝rho^(1/3), B∝rho^(2/3). The evolved energies supply additional changes.
 * Coordinates clamp to the explicitly evaluated material domain. */
export function hotResponseCoordinates(state:ArrayLike<number>,offset=0,inverseHeatCapacity=1,adiabaticExponent=1/3):number[] {
  const rho=Math.max(state[offset],1e-10);
  return [hotGridCoordinate(rho,0),
    hotGridCoordinate(state[offset+1]**inverseHeatCapacity*rho**adiabaticExponent,1),
    hotGridCoordinate(Math.sqrt(state[offset+2])*rho**(2/3),2),
    hotGridCoordinate(state[offset+3]/Math.max(state[offset+1],.1),3)];
}

export class HotFlowField {
  readonly dynamics:HotFlowDynamics;
  readonly texture:DataTexture;
  radiationScale=1;
  lastUpdateMs=0;
  saturatedFraction=0;
  private readonly weights:Float64Array;
  private readonly cooling=new Float64Array(HOT_FIELD_RADII*HOT_RESPONSE_LAYERS);
  private readonly pixels=new Float32Array(HOT_FIELD_RADII*HOT_FIELD_AZIMUTHS*4);
  private readonly budget:number;

  constructor(flow:AccretionFlow,rgM:number,spin:number,model:HotFlowModel,response:HotResponseTables) {
    this.dynamics=new HotFlowDynamics(flow,rgM,spin,model);
    this.texture=new DataTexture(this.pixels,HOT_FIELD_AZIMUTHS,HOT_FIELD_RADII,RGBAFormat,FloatType);
    this.texture.minFilter=this.texture.magFilter=LinearFilter;
    this.texture.wrapS=RepeatWrapping;this.texture.colorSpace=NoColorSpace;
    this.texture.needsUpdate=true;
    this.weights=new Float64Array(HOT_FIELD_RADII);
    this.budget=model.budgetW;
    const dx=Math.log(flow.outerRadiusRg/flow.innerRadiusRg)/HOT_FIELD_RADII;
    for(let r=0;r<HOT_FIELD_RADII;r++) {
      const radius=flow.innerRadiusRg*Math.exp((r+.5)*dx)*rgM*100;
      this.weights[r]=2*Math.PI*radius**3*flow.aspectRatio*Math.sqrt(2*Math.PI)*dx/1e7;
      const radial=(r+.5)/HOT_FIELD_RADII*(HOT_RESPONSE_RADII-1),lo=Math.min(HOT_RESPONSE_RADII-2,Math.floor(radial)),fraction=radial-lo;
      for(let layer=0;layer<HOT_RESPONSE_LAYERS;layer++)this.cooling[r*HOT_RESPONSE_LAYERS+layer]=
        response.coolingResponse[lo*HOT_RESPONSE_LAYERS+layer]*(1-fraction)
        +response.coolingResponse[(lo+1)*HOT_RESPONSE_LAYERS+layer]*fraction;
    }
    this.limitRadiation();
  }

  private limitRadiation():void {
    let power=0;
    let saturated=0;
    for(let r=0;r<HOT_FIELD_RADII;r++) {
      let sum=0;
      for(let p=0;p<HOT_FIELD_AZIMUTHS;p++) {
        const offset=(r*HOT_FIELD_AZIMUTHS+p)*4;
        const coordinates=hotResponseCoordinates(this.dynamics.state,offset,this.dynamics.thermalResponse[r*2],this.dynamics.thermalResponse[r*2+1]);
        if(coordinates.some((v,i)=>v===0||v===(i===1||i===2?4:2)))saturated++;
        this.pixels.set(coordinates,offset);
        const logPower=sampleHotCooling(this.cooling,r*HOT_RESPONSE_LAYERS,coordinates);
        sum+=Math.exp(logPower);
      }
      power+=sum/HOT_FIELD_AZIMUTHS*this.weights[r];
    }
    // Only attenuate if the estimated escaping power exceeds the common
    // budget. This never normalizes an optical peak or brightens a dim flow.
    this.radiationScale=Math.min(1,this.budget/Math.max(power,1e-100));
    this.saturatedFraction=saturated/(HOT_FIELD_RADII*HOT_FIELD_AZIMUTHS);
  }

  advance(orbits:number):void {
    const start=performance.now();
    if(this.dynamics.advance(orbits)) {
      this.limitRadiation();
      this.texture.needsUpdate=true;
      this.lastUpdateMs=performance.now()-start;
    }
  }

  get ranges():number[][] {
    const ranges=Array.from({length:4},()=>[Infinity,-Infinity]);
    this.dynamics.state.forEach((v,i)=>{ranges[i%4][0]=Math.min(ranges[i%4][0],v);ranges[i%4][1]=Math.max(ranges[i%4][1],v);});
    return ranges;
  }

  dispose():void { this.texture.dispose(); }
}
