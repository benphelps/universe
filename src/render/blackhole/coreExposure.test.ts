import { expect,it } from 'vitest';
import { gravitationalRadius } from '../../core/physics/blackHole';
import { accretionFlowFor } from '../../universe/galaxy/accretionFlow';
import { buildHotFlowTables } from './hotFlowSpectrum';
import { coreExposureFor,DEFAULT_CORE_EXPOSURE } from './coreExposure';

it('retains the sky preset until spectra are ready',()=>{
  expect(coreExposureFor(accretionFlowFor(321000,.89,1e-5),1)).toBe(DEFAULT_CORE_EXPOSURE);
});
it('does not brighten a quiescent flow to fill the display',()=>{
  const mass=4e6,rg=gravitationalRadius(mass),flow=accretionFlowFor(mass,.5,1e-9);
  expect(coreExposureFor(flow,rg,buildHotFlowTables(flow,rg))).toBe(DEFAULT_CORE_EXPOSURE);
});
it('meters the bright low-mass core without changing its spectrum',()=>{
  const mass=7183.528434922727,rg=gravitationalRadius(mass);
  const flow=accretionFlowFor(mass,.9534083525836765,.001462966840030447,{magneticFlux:8.39310413127019});
  const data=buildHotFlowTables(flow,rg),before=data.emission.slice();
  const exposure=coreExposureFor(flow,rg,data);
  expect(exposure).toBeGreaterThan(1e-6);
  expect(exposure).toBeLessThan(.001);
  expect(data.emission).toEqual(before);
});
