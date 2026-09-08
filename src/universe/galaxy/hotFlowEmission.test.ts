import { expect, it } from 'vitest';
import { gravitationalRadius } from '../../core/physics/blackHole';
import { accretionFlowFor } from './accretionFlow';
import { bremsstrahlungPower, buildHotFlowModel, hotElectrons, hotPlasmaAt, hotShellSpectrum, plasmaSpectrum, synchrotronKernel } from './hotFlowEmission';

const flow=accretionFlowFor(4e6,.5,1e-6),rg=gravitationalRadius(4e6);
const plasma=()=>hotPlasmaAt(flow,rg,10);
it('matches independent synchrotron kernel reference values and the low-frequency limit',()=>{
  expect(synchrotronKernel(.29)).toBeCloseTo(.917984,3);
  expect(synchrotronKernel(1)).toBeCloseTo(.651423,3);
  expect(synchrotronKernel(1e-10)/Math.cbrt(1e-10)).toBeCloseTo(2.149528,5);
  expect(synchrotronKernel(100)).toBe(0);
});
it('conserves electron number and bounds the tail by kinetic energy',()=>{
  const p=plasma(),population=hotElectrons(p);
  const count=population.bins.reduce((sum,b)=>sum+b.thermal+b.tail,0);
  expect(count/p.electronDensityCm3).toBeCloseTo(1,10);
  expect(population.tailEnergy/(population.thermalEnergy+population.tailEnergy)).toBeCloseTo(.01,10);
  expect(population.tailNumber/count).toBeLessThan(.01);
  expect(hotElectrons(p,0).tailEnergy).toBe(0);
});
it('has the steady-inflow mass scaling and does not call dim plasma cool',()=>{
  const large=hotPlasmaAt(accretionFlowFor(4e7,.5,1e-6),10*rg,10),small=plasma();
  expect(large.electronDensityCm3/small.electronDensityCm3).toBeCloseTo(.1,10);
  expect(large.magneticGauss/small.magneticGauss).toBeCloseTo(Math.sqrt(.1),10);
  const dim=hotPlasmaAt(accretionFlowFor(4e6,.5,1e-9),rg,10);
  expect(dim.electronTemperatureK).toBeGreaterThan(1e9);
  expect(dim.electronDensityCm3).toBeLessThan(small.electronDensityCm3);
});
it('recovers nonrelativistic free-free cooling and density-squared scaling',()=>{
  const p={...plasma(),electronTemperatureK:1e7,theta:1e7/5.9298966e9};
  // The cooling fit includes an effective frequency-averaged Gaunt factor near 1.4.
  const expected=1.426e-27*1.4*p.electronDensityCm3**2*Math.sqrt(1e7);
  expect(bremsstrahlungPower(p)/expected).toBeGreaterThan(.9);
  expect(bremsstrahlungPower(p)/expected).toBeLessThan(1.1);
  expect(bremsstrahlungPower({...p,electronDensityCm3:2*p.electronDensityCm3})/bremsstrahlungPower(p)).toBeCloseTo(4,10);
});
it('adds visible synchrotron through energetic electrons, with positive absorption',()=>{
  const p=plasma(),thermal=hotElectrons(p,0),hybrid=hotElectrons(p);
  const cold=plasmaSpectrum(p,thermal,5e14),tail=plasmaSpectrum(p,hybrid,5e14);
  expect(tail.synchrotron).toBeGreaterThan(cold.synchrotron*100);
  expect(tail.absorption).toBeGreaterThan(0);
  const higher=plasmaSpectrum(p,hybrid,1e15);
  expect(higher.synchrotron).toBeLessThan(tail.synchrotron);
});
it('keeps the spectrum finite and accounts for absorbed energy outside the visible band',()=>{
  const s=hotShellSpectrum(plasma());
  expect(s.emission.every(x=>Number.isFinite(x)&&x>=0)).toBe(true);
  expect(s.absorption.every(x=>Number.isFinite(x)&&x>=0)).toBe(true);
  expect(s.escapedPower).toBeGreaterThan(0);
  expect(s.escapedPower).toBeLessThan(s.emittedPower);
});
it('never exceeds or artificially fills its bolometric power budget',()=>{
  const model=buildHotFlowModel(flow,rg,8);
  expect(model.escapedLuminosityW).toBeLessThanOrEqual(flow.luminosityW*(1+1e-12));
  expect(model.escapedLuminosityW).toBeLessThanOrEqual(model.emittedLuminosityW);
  expect(model.powerScale).toBeGreaterThan(0);
  expect(model.powerScale).toBeLessThanOrEqual(1);
});
