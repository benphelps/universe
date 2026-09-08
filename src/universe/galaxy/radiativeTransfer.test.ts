import { expect,it } from 'vitest';
import { columnEscape,kleinNishinaRatio,localScatteringSource } from './radiativeTransfer';
const frequencies=Float64Array.from({length:64},(_,i)=>2**(i/4));
it('recovers transparent and opaque slab transfer without cancellation',()=>{
  expect(columnEscape(0)).toBe(1);
  expect(columnEscape(1e-8)).toBeCloseTo(1-5e-9,14);
  expect(columnEscape(100)).toBeCloseTo(.01,14);
});
it('has the Thomson limit and independent Klein–Nishina reference values',()=>{
  expect(kleinNishinaRatio(0)).toBe(1);
  expect(kleinNishinaRatio(1)).toBeCloseTo(.43072784,7);
  expect(kleinNishinaRatio(10)).toBeCloseTo(.12275976,7);
});
it('keeps direct light intact and applies absorption once',()=>{
  const seed=new Float64Array(64).fill(2),abs=new Float64Array(64).fill(.3);
  const {source,escape}=localScatteringSource(seed,abs,new Float64Array(64),frequencies,10,x=>x*2);
  expect(source).toEqual(seed);
  expect(source[20]*escape[20]*10).toBeCloseTo(2/.3*(1-Math.exp(-3)),12);
});
it('conserves photons under elastic scattering and converges as orders increase',()=>{
  const seed=new Float64Array(64);seed[20]=1;
  const sc=new Float64Array(64).fill(.4),abs=new Float64Array(64);
  const short=localScatteringSource(seed,abs,sc,frequencies,1,x=>x,3);
  const full=localScatteringSource(seed,abs,sc,frequencies,1,x=>x,24);
  expect(short.source[20]*short.escape[20]).toBeLessThanOrEqual(1);
  expect(full.source[20]*full.escape[20]).toBeCloseTo(1,12);
});
it('redistributes photon number and mean energy across an off-grid frequency shift',()=>{
  const seed=new Float64Array(64);seed[20]=1;
  const {source,escape}=localScatteringSource(seed,new Float64Array(64),new Float64Array(64).fill(.2),frequencies,1,x=>x*2.3,1);
  const scattered=source.map((v,i)=>v-seed[i]);
  expect(scattered.reduce((a,b)=>a+b,0)).toBeCloseTo(1-escape[20],12);
  expect(scattered.reduce((a,b,i)=>a+b*frequencies[i],0)).toBeCloseTo((1-escape[20])*frequencies[20]*2.3,10);
});
it('accounts for absorption, escaping photons and the truncated scattering remainder',()=>{
  const seed=new Float64Array(64).fill(1),abs=new Float64Array(64).fill(.3),sc=new Float64Array(64).fill(2);
  const result=localScatteringSource(seed,abs,sc,frequencies,1,x=>x*1.7);
  expect(result.escapedPhotons+result.absorbedPhotons+result.unresolvedPhotons+result.outOfBandPhotons).toBeCloseTo(64,10);
  expect(result.unresolvedPhotons).toBeGreaterThan(0);
});
