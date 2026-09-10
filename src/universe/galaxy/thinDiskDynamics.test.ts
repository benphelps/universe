import { expect,it } from 'vitest';
import { accretionFlowFor } from './accretionFlow';
import { compressDiskRing,diskDrivingCoefficients,driftDisk,thinDiskEnergy,rotateDiskRing,ThinDiskDynamics,THIN_DISK_AZIMUTHS,THIN_DISK_RADII,THIN_DISK_STEP } from './thinDiskDynamics';

const flow=accretionFlowFor(321000,.89,.1);
const total=(a:Float32Array,c:number)=>a.reduce((sum,v,i)=>sum+(i%4===c?v:0),0);

it('rotates positive conserved reservoirs across the seam without first-order diffusion',()=>{
  const n=128,a=new Float32Array(n*4),b=new Float32Array(n*4);
  for(let p=0;p<n;p++)a.set([1+.5*Math.cos(2*Math.PI*p/n),1+.3*Math.sin(4*Math.PI*p/n),1,1],p*4);
  const initial=a.slice();
  for(let step=0;step<256;step++){rotateDiskRing(a,b,0,n,.5);a.set(b);}
  for(let c=0;c<3;c++)expect(total(a,c)).toBeCloseTo(total(initial,c),4);
  // One full revolution: retain the smooth patch instead of smearing it out.
  const error=a.reduce((sum,v,i)=>sum+(i%4<3?Math.abs(v-initial[i]):0),0)/(n*3);
  expect(error).toBeLessThan(.003);
  expect(Math.min(...a.filter((_,i)=>i%4<3))).toBeGreaterThanOrEqual(.5-1e-6);
});

it('compression conserves mass and energy rather than multiplying density in place',()=>{
  const n=128,a=new Float32Array(n*4),b=new Float32Array(n*4);
  for(let p=0;p<n;p++)a.set([1,1,Math.exp(Math.sin(2*Math.PI*p/n)),1],p*4);
  compressDiskRing(a,b,0,n,1,THIN_DISK_STEP);
  for(let c=0;c<3;c++)expect(total(b,c)).toBeCloseTo(total(a,c),5);
  expect(b.some((v,i)=>i%4===0&&v!==1)).toBe(true);
  expect(b.every((v,i)=>i%4===3||v>0)).toBe(true);
});

it('accounts for supply and ISCO loss with equilibrium ring masses',()=>{
  const source=new Float32Array([2,3,4,1, 3,4,5,1, 4,5,6,1]),target=new Float32Array(12);
  const masses=[1,2,4],rates=new Float64Array(masses.map(m=>.2/m));
  driftDisk(source,target,rates,.5,1);
  for(let c=0;c<3;c++) {
    const sum=(v:Float32Array)=>masses.reduce((s,m,r)=>s+m*v[r*4+c],0);
    expect(sum(target)-sum(source)).toBeCloseTo(.1*(1-source[c]),5);
  }
});

it('thermal relaxation has lag, stays positive and balances supplied and radiated energy',()=>{
  for(const dt of [0,1e-8,.1,1,100]) {
    const next=thinDiskEnergy(2,.3,-Math.expm1(-.6*dt));
    expect(next).toBeCloseTo(.3+1.7*Math.exp(-.6*dt),12);
    const supplied=.3*.6*dt,radiated=2+supplied-next;
    expect(next).toBeGreaterThanOrEqual(.3);
    expect(radiated).toBeGreaterThanOrEqual(0);
  }
  const heated=thinDiskEnergy(1,2,-Math.expm1(-.6*.1));
  expect(heated).toBeGreaterThan(1);expect(heated).toBeLessThan(2);
  expect(thinDiskEnergy(1,1,-Math.expm1(-.6*2))).toBe(1);
});

it('uses independent seeds at identical physical parameters and fixed steps across frame batching',()=>{
  const a=new ThinDiskDynamics(flow,.89,12n),b=new ThinDiskDynamics(flow,.89,12n),other=new ThinDiskDynamics(flow,.89,13n);
  expect(a.state).toEqual(b.state);expect(a.state).not.toEqual(other.state);
  const initial=a.state.slice();
  for(let i=0;i<60;i++){a.advance(1/120);b.advance(1/240);b.advance(1/240);}
  expect(a.state).toEqual(b.state);expect(a.state).not.toEqual(initial);
  const paused=a.state.slice();expect(a.advance(0)).toBe(false);expect(a.state).toEqual(paused);
  const time=a.time;a.advance(1e9);
  expect(a.lastSubsteps).toBeLessThanOrEqual(5);expect(a.time-time).toBeLessThanOrEqual(5*THIN_DISK_STEP+1e-10);
  expect(a.advance(Infinity)).toBe(false);expect(a.advance(NaN)).toBe(false);
});

it('retains finite evolving structure, a stable mean heating budget and differential rotation',()=>{
  const d=new ThinDiskDynamics(flow,.89,12n);
  for(let i=0;i<500;i++)d.advance(.02);
  expect(d.state.every(v=>v>0&&Number.isFinite(v))).toBe(true);
  expect(d.orbitalRates[0]).toBeGreaterThan(d.orbitalRates[10]);
  expect(d.driftRates[0]).toBeLessThan(d.orbitalRates[0]);
  let contrast=0;
  for(let r=0;r<THIN_DISK_RADII;r++) {
    let heat=0;
    for(let p=0;p<THIN_DISK_AZIMUTHS;p++) {
      const i=(r*THIN_DISK_AZIMUTHS+p)*4;
      heat+=d.state[i+1]/THIN_DISK_AZIMUTHS;
      contrast+=(d.state[i+1]-1)**2/d.state.length*4;
    }
    expect(heat).toBeCloseTo(1,4);
  }
  expect(contrast).toBeGreaterThan(.005);
  const innerVariance=d.state.slice(0,8*THIN_DISK_AZIMUTHS*4)
    .reduce((sum,v,i)=>sum+(i%4===1?(v-1)**2:0),0)/(8*THIN_DISK_AZIMUTHS);
  expect(innerVariance).toBeGreaterThan(.0001);
},20000);

it('renews orbital driving continuously even after a long displayed history',()=>{
  const before=new Float64Array(8),at=new Float64Array(8),after=new Float64Array(8);
  for(const time of [1,2,10,1000,1000000]) {
    diskDrivingCoefficients(91827,time-1e-8,before);
    diskDrivingCoefficients(91827,time,at);
    diskDrivingCoefficients(91827,time+1e-8,after);
    for(let i=0;i<8;i++) {
      expect(Math.abs(after[i]-before[i])).toBeLessThan(.00001);
      expect(Math.abs(at[i])).toBeLessThanOrEqual(1.000001);
    }
  }
});
