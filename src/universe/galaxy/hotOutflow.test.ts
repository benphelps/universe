import { expect,it } from 'vitest';
import { gravitationalRadius } from '../../core/physics/blackHole';
import { C_LIGHT, PROTON_MASS } from '../../core/physics/constants';
import { accretionFlowFor } from './accretionFlow';
import { hotInflowRate, OUTFLOW } from './hotOutflow';
import { outflowAngular, outflowAt, outflowPlasma } from './hotOutflowEmission';
import { hotPlasmaAt } from './hotFlowEmission';
import { transportHotField } from './hotFlowDynamics';

it('closes the horizon, wind and jet mass ledger without changing L = eta Mdot c²',()=>{
  for(const spin of [0,.5,.998])for(const feeding of [1e-9,1e-5,.009999]) {
    const f=accretionFlowFor(4e6,spin,feeding),p=f.outflows!;
    expect(f.luminosityW/(f.efficiency*f.rateKgPerS*C_LIGHT**2)).toBeCloseTo(1,12);
    expect(hotInflowRate(f,f.innerRadiusRg)/f.rateKgPerS).toBeCloseTo(1,12);
    expect(p.outerSupplyKgPerS/(f.rateKgPerS+p.jetMassKgPerS+p.windMassKgPerS)).toBeCloseTo(1,12);
    expect(hotInflowRate(f,f.outerRadiusRg)/p.outerSupplyKgPerS).toBeCloseTo(1,12);
    expect(p.windPowerW).toBeLessThanOrEqual(p.windAvailableW*(1+1e-12));
    expect(outflowAt(f,'wind',60).mass/p.windMassKgPerS).toBeCloseTo(1,12);
    expect(outflowAt(f,'jet',60).mass).toBe(p.jetMassKgPerS);
  }
});
it('requires both spin and magnetic flux for BZ power and suppresses winds toward the thin-disc transition',()=>{
  expect(accretionFlowFor(4e6,0,1e-5).outflows!.jetPowerW).toBe(0);
  expect(accretionFlowFor(4e6,.9,1e-5,{magneticFlux:0}).outflows!.jetPowerW).toBe(0);
  const a=accretionFlowFor(4e6,.9,1e-5,{magneticFlux:10}),b=accretionFlowFor(4e6,.9,1e-5,{magneticFlux:20});
  expect(b.outflows!.jetPowerW/a.outflows!.jetPowerW).toBeCloseTo(4,12);
  expect(accretionFlowFor(4e6,.9,.009999).outflows!.windIndex).toBeLessThan(.001);
  expect(accretionFlowFor(4e6,.9,.01).outflows).toBeUndefined();
  const off=accretionFlowFor(4e6,.9,1e-5,{windIndex:0,magneticFlux:0});
  expect(hotInflowRate(off,60)).toBe(off.rateKgPerS);
});
it('normalizes both angular mass profiles and recovers comoving continuity and Poynting power',()=>{
  const f=accretionFlowFor(4e6,.9,1e-5),rg=gravitationalRadius(4e6);
  for(const kind of ['wind','jet'] as const) {
    let integral=0;
    for(let i=0;i<100000;i++)integral+=outflowAngular(kind,(i+.5)/100000)/100000;
    expect(integral).toBeCloseTo(1,6);
    const mu=kind==='wind'?.7:.998,p=outflowPlasma(f,rg,kind,20,mu,.3)!;
    const at=outflowAt(f,kind,20),gamma=1/Math.sqrt(1-at.beta**2),v=at.beta*C_LIGHT*100;
    const area=4*Math.PI*p.radiusCm**2,h=outflowAngular(kind,mu);
    expect(p.electronDensityCm3*(PROTON_MASS*1000)*area*gamma*v/(h*at.mass*1000)).toBeCloseTo(1,12);
    expect(p.magneticGauss**2/(4*Math.PI)*gamma**2*v*area/(h*at.magneticW*1e7)).toBeCloseTo(1,12);
    expect(outflowPlasma(f,rg,kind,2,mu,1)).toBeNull();
  }
});
it('changes the outer density slope consistently with mass loss, preserving mass scaling',()=>{
  const f=accretionFlowFor(4e6,.5,1e-6),rg=gravitationalRadius(4e6);
  const n=(r:number)=>hotPlasmaAt(f,rg,r).electronDensityCm3;
  expect(Math.log(n(40)/n(20))/Math.log(2)).toBeCloseTo(f.outflows!.windIndex-1.5,10);
  expect(OUTFLOW.jetKinetic+OUTFLOW.jetMagnetic+OUTFLOW.jetElectrons).toBe(1);
});
it('removes local material with mass loss, closing transported perturbation mass including boundary fluxes',()=>{
  const f=accretionFlowFor(4e6,.5,1e-6),nr=12,np=4,dt=.001,dx=Math.log(60/f.innerRadiusRg)/nr;
  const source=new Float32Array(nr*np*4),target=new Float32Array(source.length),radial=new Float64Array(nr),mass=new Float64Array(nr),flux=new Float64Array(nr+1);
  for(let r=0;r<=nr;r++)flux[r]=hotInflowRate(f,f.innerRadiusRg*Math.exp(r*dx))/f.rateKgPerS;
  for(let r=0;r<nr;r++) {
    const radius=f.innerRadiusRg*Math.exp((r+.5)*dx);
    mass[r]=hotInflowRate(f,radius)/f.rateKgPerS*radius**1.5*dx;radial[r]=flux[r+1]/mass[r];
    for(let p=0;p<np;p++)source.set([1+.2*Math.sin(r+p),1,1,1],(r*np+p)*4);
  }
  transportHotField(source,target,radial,new Float64Array(nr),dt,nr,np);
  let actual=0,expected=0;
  for(let p=0;p<np;p++) {
    expected+=dt*(flux[nr]-flux[0]*source[p*4]);
    for(let r=0;r<nr;r++) {
      const i=(r*np+p)*4;
      actual+=mass[r]*(target[i]-source[i]);
      expected-=dt*(flux[r+1]-flux[r])*source[i];
    }
  }
  expect(Math.abs(actual-expected)).toBeLessThan(2e-5);
});
