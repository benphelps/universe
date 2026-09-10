import { expect,it } from 'vitest';
import { accretionFlowFor } from '../../universe/galaxy/accretionFlow';
import { THIN_DISK_STEP } from '../../universe/galaxy/thinDiskDynamics';
import { ThinDiskField } from './thinDiskField';

it('interpolates fixed gas states smoothly and does not upload on pause',()=>{
  const f=new ThinDiskField(accretionFlowFor(321000,.89,.1),.89,17n);
  const pixels=f.texture.image.data as Float32Array,initial=pixels.slice();
  f.advance(THIN_DISK_STEP);
  // At the step boundary display still starts at the previous state.
  expect(pixels).toEqual(initial);
  f.advance(THIN_DISK_STEP/2);
  for(let i=0;i<pixels.length;i+=4)for(let c=0;c<2;c++)
    expect(pixels[i+c]).toBeCloseTo((initial[i+c]+f.dynamics.state[i+c])/2,6);
  const paused=pixels.slice(),version=f.texture.version;
  f.advance(0);f.advance(NaN);
  expect(pixels).toEqual(paused);expect(f.texture.version).toBe(version);
  expect(pixels.byteLength).toBe(131072);f.dispose();
});
