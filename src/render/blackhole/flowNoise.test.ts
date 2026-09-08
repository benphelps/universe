import { expect, it, vi } from 'vitest';
import { Vector3, Vector4 } from 'three';
import { acquireFlowNoise, FLOW_NOISE_SIZE, updateFlowEddies } from './flowNoise';

it('shares a bounded material texture and releases GPU storage with its last owner',()=>{
  const a=acquireFlowNoise(),b=acquireFlowNoise();
  expect(a.texture).toBe(b.texture);
  expect(a.texture.image.data?.byteLength).toBe(FLOW_NOISE_SIZE**3);
  const dispose=vi.fn();a.texture.addEventListener('dispose',dispose);
  a.release();a.release();expect(dispose).not.toHaveBeenCalled();
  b.release();expect(dispose).toHaveBeenCalledOnce();
  const c=acquireFlowNoise();expect(c.texture).not.toBe(a.texture);
  expect(c.texture.image.data).toBe(a.texture.image.data);c.release();
});

it('keeps animation weights normalized and reuses the same eddy through a generation boundary',()=>{
  const before=new Vector4(),after=new Vector4();
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),d=new Vector3();
  updateFlowEddies(2-1e-6,before,a,b);
  updateFlowEddies(2+1e-6,after,c,d);
  expect(a.distanceTo(d)).toBe(0);
  expect(before.x).toBeCloseTo(after.y,4);
  for(const phase of [before,after])expect(phase.z**2+phase.w**2).toBeCloseTo(1,12);
  for(const offset of [a,b,c,d])for(const value of offset.toArray()){
    expect(value).toBeGreaterThanOrEqual(0);expect(value).toBeLessThan(128);
  }
});
