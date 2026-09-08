import { Data3DTexture, LinearFilter, RedFormat, RepeatWrapping } from 'three';
import { createPeriodicPerlin3 } from '../../core/noise/periodic3';

export const FLOW_NOISE_SIZE = 128;
export const FLOW_NOISE_PERIOD = 16;
export const FLOW_NOISE_RANGE = 1.6;
let pixels: Uint8Array | undefined;
let shared: Data3DTexture | undefined;
let users = 0;

/** Material-space noise, independent of camera or output resolution.
 * Eight texels per lattice cell preserve the smooth field under hardware
 * interpolation. Replaces two procedural noise evaluations per gas sample.
 * Keep one 2 MiB CPU tile for reuse; release GPU storage with its last owner. */
export function flowNoisePixels():Uint8Array {
  if (!pixels) {
    const noise = createPeriodicPerlin3(0x42484e4f495345n, FLOW_NOISE_PERIOD);
    const size = FLOW_NOISE_SIZE, scale = FLOW_NOISE_PERIOD / size;
    pixels = new Uint8Array(size ** 3);
    let at = 0;
    for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const value = noise((x+.5)*scale, (y+.5)*scale, (z+.5)*scale);
      pixels[at++] = Math.round(255*Math.max(0, Math.min(1, .5+value/(2*FLOW_NOISE_RANGE))));
    }
  }
  return pixels;
}
export function acquireFlowNoise(prepared?:Uint8Array): { texture: Data3DTexture; release(): void } {
  pixels??=prepared??flowNoisePixels();
  if (!shared) {
    shared = new Data3DTexture(pixels, FLOW_NOISE_SIZE, FLOW_NOISE_SIZE, FLOW_NOISE_SIZE);
    shared.format = RedFormat;
    shared.minFilter = shared.magFilter = LinearFilter;
    shared.wrapS = shared.wrapT = shared.wrapR = RepeatWrapping;
    shared.unpackAlignment = 1;
    shared.needsUpdate = true;
  }
  users++;
  let released = false;
  return { texture: shared, release() {
    if (released) return;
    released = true;
    if (--users === 0) { shared?.dispose(); shared = undefined; }
  } };
}

/** All generations share this lifetime, in turns of the inner flow. */
export const FLOW_EDDY_LIFETIME = 4;

/** Animation coefficients are uniform over the image. Compute them once
 * per update rather than redoing trigonometry and hashing in every cell. */
export function updateFlowEddies(
  turns: number,
  phase: import('three').Vector4,
  newer: import('three').Vector3,
  older: import('three').Vector3,
): void {
  const t=2*Math.fround(turns)/FLOW_EDDY_LIFETIME;
  const generation=Math.floor(t),f=t-generation;
  phase.set(9+Math.PI*f*FLOW_EDDY_LIFETIME,9+Math.PI*(1+f)*FLOW_EDDY_LIFETIME,
    Math.sin(Math.PI/2*f),Math.cos(Math.PI/2*f));
  const fract=(x:number)=>x-Math.floor(x);
  const offset=(g:number,out:import('three').Vector3)=>{
    g=((g%4096)+4096)%4096;
    let x=fract(g*.1031),y=fract(g*.11369),z=fract(g*.13787);
    const dot=x*(y+33.33)+y*(z+33.33)+z*(x+33.33);
    x+=dot;y+=dot;z+=dot;
    out.set(fract((x+y)*z)*128,fract((x+z)*y)*128,fract((y+z)*x)*128);
  };
  offset(generation,newer);offset(generation-1,older);
}
