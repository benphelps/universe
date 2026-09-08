import { expect,it } from 'vitest';
import { gravitationalRadius } from '../../core/physics/blackHole';
import { accretionFlowFor } from './accretionFlow';
import { buildHotFlowModel } from './hotFlowEmission';
import { heatPlasma,HotFlowDynamics,transportHotField } from './hotFlowDynamics';

it('balances magnetic work, particle acceleration and emitted energy without negative reservoirs',()=>{
  const before={thermal:2,magnetic:5,tail:.2};
  for(const dt of [0,.01,1,1000]) {
    const after=heatPlasma(before,{drive:.3,dissipation:2,thermalCooling:1,tailCooling:20,acceleration:.2},dt);
    expect(after.thermal+after.magnetic+after.tail+after.radiated).toBeCloseTo(7.2+after.supplied,10);
    expect(Math.min(after.thermal,after.magnetic,after.tail,after.radiated)).toBeGreaterThanOrEqual(0);
  }
  const noSource=heatPlasma({thermal:0,magnetic:0,tail:0},{drive:0,dissipation:2,thermalCooling:1,tailCooling:10,acceleration:.2},1);
  expect(noSource.tail+noSource.thermal+noSource.radiated).toBe(0);
});

it('conserves mass and transported specific energy through the periodic seam',()=>{
  const source=new Float32Array(4*8),target=new Float32Array(source.length);
  for(let p=0;p<8;p++)source.set([p===7?2:1,1+.1*p,1,1],p*4);
  transportHotField(source,target,new Float64Array([0]),new Float64Array([1]),.4,1,8);
  const sum=(data:Float32Array,c:number)=>Array.from({length:8},(_,p)=>data[p*4]*(c?data[p*4+c]:1)).reduce((a,b)=>a+b,0);
  expect(sum(target,0)).toBeCloseTo(sum(source,0),6);
  expect(sum(target,1)).toBeCloseTo(sum(source,1),6);
  expect(target[0]).toBeGreaterThan(source[0]);
});

it('accounts for outer supply and inner loss in radial mass transport',()=>{
  const source=new Float32Array([2,1,1,1, 3,1,1,1, 4,1,1,1]),target=new Float32Array(12);
  const masses=[1,2,4],rates=new Float64Array(masses.map(m=>.2/m));
  transportHotField(source,target,rates,new Float64Array(3),1,3,1);
  const mass=(a:Float32Array)=>masses.reduce((sum,m,r)=>sum+m*a[r*4],0);
  expect(mass(target)-mass(source)).toBeCloseTo(.2*(1-source[0]),5);
});

it('evolves reproducibly, holds on pause and bounds work after huge time jumps',()=>{
  const flow=accretionFlowFor(321000,.89,1e-5),rg=gravitationalRadius(321000),model=buildHotFlowModel(flow,rg);
  const a=new HotFlowDynamics(flow,rg,.89,model),b=new HotFlowDynamics(flow,rg,.89,model);
  const initial=a.state.slice();
  expect(a.advance(0)).toBe(false);
  expect(a.state).toEqual(initial);
  for(let i=0;i<1000;i++){a.advance(.01);b.advance(.01);}
  expect(a.state).toEqual(b.state);
  expect(a.state).not.toEqual(initial);
  expect(a.state.every(x=>Number.isFinite(x)&&x>0)).toBe(true);
  const time=a.time;a.advance(1e9);
  expect(a.time-time).toBeCloseTo(.02,10);
  expect(a.lastSubsteps).toBeLessThan(10);
  for(let r=0;r<a.thermalResponse.length/2;r++) {
    expect(a.thermalResponse[r*2]).toBeGreaterThan(.6);
    expect(a.thermalResponse[r*2]).toBeLessThanOrEqual(1.01);
    expect(a.thermalResponse[r*2+1]).toBeGreaterThan(1/3-.01);
    expect(a.thermalResponse[r*2+1]).toBeLessThan(2/3+.01);
  }
});
