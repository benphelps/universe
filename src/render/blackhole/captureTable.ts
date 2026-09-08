import { DataTexture, FloatType, NearestFilter, RGFormat, Vector2 } from 'three';
import { criticalConstants } from '../../core/physics/kerr';
import { clampSpin } from '../../core/physics/blackHole';

export const CAPTURE_TABLE_SIZE = 512;
/** Brackets the exact spherical photon orbit by angular momentum.
 * Each entry stores radius and critical Carter constant. The shader
 * decides only when the whole bracket agrees, and bisects otherwise. */
export function createCaptureTable(spin: number) {
  const a = Math.max(Math.abs(clampSpin(spin)), .01);
  const pro = 2*(1+Math.cos(2/3*Math.acos(-a)));
  const retro = 2*(1+Math.cos(2/3*Math.acos(a)));
  const min = criticalConstants(retro,a).xi, max = criticalConstants(pro,a).xi;
  const data = new Float32Array(CAPTURE_TABLE_SIZE*2);
  for(let i=0;i<CAPTURE_TABLE_SIZE;i++) {
    const xi = min+(max-min)*i/(CAPTURE_TABLE_SIZE-1);
    let lo=pro,hi=retro;
    for(let j=0;j<40;j++) {
      const mid=(lo+hi)/2;
      if(criticalConstants(mid,a).xi>xi)lo=mid;else hi=mid;
    }
    const r=(lo+hi)/2;
    data[i*2]=r;data[i*2+1]=criticalConstants(r,a).eta;
  }
  const texture = new DataTexture(data,CAPTURE_TABLE_SIZE,1,RGFormat,FloatType);
  texture.minFilter=texture.magFilter=NearestFilter;texture.needsUpdate=true;
  return {texture,range:new Vector2(min,max)};
}
