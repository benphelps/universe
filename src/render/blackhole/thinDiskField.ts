import { DataTexture, FloatType, LinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat } from 'three';
import type { AccretionFlow } from '../../universe/galaxy/accretionFlow';
import { ThinDiskDynamics, THIN_DISK_RADII, THIN_DISK_AZIMUTHS } from '../../universe/galaxy/thinDiskDynamics';

/** 128 KiB of evolving material, independent of the native image size.
 * Both the strong-lensing trace and distant surface use this same field. */
export class ThinDiskField {
  readonly dynamics:ThinDiskDynamics;
  readonly texture:DataTexture;
  private readonly pixels=new Float32Array(THIN_DISK_AZIMUTHS*THIN_DISK_RADII*4);
  version=0;
  lastUpdateMs=0;
  constructor(flow:AccretionFlow,spin:number,seed:bigint) {
    this.dynamics=new ThinDiskDynamics(flow,spin,seed);
    this.pixels.set(this.dynamics.state);
    this.texture=new DataTexture(this.pixels,THIN_DISK_AZIMUTHS,THIN_DISK_RADII,RGBAFormat,FloatType);
    this.texture.minFilter=this.texture.magFilter=LinearFilter;
    this.texture.wrapS=RepeatWrapping;
    this.texture.colorSpace=NoColorSpace;
    this.texture.needsUpdate=true;
  }
  advance(orbits:number):void {
    if(!(orbits>0)||!Number.isFinite(orbits))return;
    const start=performance.now();
    this.dynamics.advance(orbits);
    if(!this.dynamics.version)return;
    // Smooth display between fixed states, at a latency of one 1/240 orbit
    // step. A slow physical clock must not visibly jump half a grid cell.
    const d=this.dynamics,t=d.interpolation;
    for(let i=0;i<this.pixels.length;i+=4)for(let c=0;c<2;c++)
      this.pixels[i+c]=d.previous[i+c]+(d.state[i+c]-d.previous[i+c])*t;
    this.version++;
    this.texture.needsUpdate=true;
    this.lastUpdateMs=performance.now()-start;
  }
  dispose():void {this.texture.dispose();}
}
