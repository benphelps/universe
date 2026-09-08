import { expect, it } from 'vitest';
import { spectrumToXyz } from '../../core/color/xyz';
import { C_LIGHT } from '../../core/physics/constants';
import { gravitationalRadius } from '../../core/physics/blackHole';
import { accretionFlowFor } from '../../universe/galaxy/accretionFlow';
import { hotShellSpectrum, sampleHotSpectrum } from '../../universe/galaxy/hotFlowEmission';
import { buildHotResponseTables, buildHotFlowTables, createHotFlowSpectrum, HOT_SHIFT_COUNT, HOT_LOG_SHIFT_MIN, HOT_LOG_SHIFT_MAX, HOT_VISIBLE_REFERENCE, HOT_RESPONSE_RADII, HOT_RESPONSE_SHIFTS, HOT_RESPONSE_LAYERS, hotGridCoordinate, interpolateHotParameters, sampleHotCooling, receivedAbsorption, HOT_ABSORPTION_NM } from './hotFlowSpectrum';
import { gamutMap,xyzToLinearSrgb } from '../../core/color/srgb';
import { HotFlowField } from './hotFlowField';

const mass = 4e6, rg = gravitationalRadius(mass);
const flow = accretionFlowFor(mass, .5, 1e-6);

it('samples color-dependent extinction at the emitted frequency without Doppler-brightening opacity',()=>{
  const shell=hotShellSpectrum(buildHotFlowTables(flow,rg).model.shells[12].plasma);
  for(const g of [.4,1,2]) {
    const sampled=receivedAbsorption(shell,g,rg*100).map(x=>2**x);
    for(let c=0;c<3;c++)expect(sampled[c]).toBeCloseTo(
      sampleHotSpectrum(shell.absorption,C_LIGHT/(HOT_ABSORPTION_NM[c]*1e-9)/g)*rg*100,12);
    expect(sampled[0]).toBeGreaterThan(sampled[2]);
  }
});

it('interpolates the separate opacity bank against a held-out local plasma state',()=>{
  const data=buildHotFlowTables(flow,rg),response=buildHotResponseTables(data,rg);
  const row=5,p={...response.shells[row].plasma};
  const factors=[1.1,.94,1.08,1.2];
  p.electronDensityCm3*=factors[0];p.electronTemperatureK*=factors[1];p.theta*=factors[1];p.magneticGauss*=factors[2];
  const exact=receivedAbsorption(hotShellSpectrum(p,.01*factors[3]),1,rg*100).map(x=>2**x);
  const layerSize=HOT_RESPONSE_RADII*HOT_RESPONSE_SHIFTS*4;
  // g=1 is a grid node in the local response.
  const shift=30;
  for(let c=0;c<3;c++) {
    const log=interpolateHotParameters(factors.map(hotGridCoordinate),layer=>
      response.pixels[(2*layer+1)*layerSize+(row*HOT_RESPONSE_SHIFTS+shift)*4+c]);
    expect(Math.abs(2**log/exact[c]-1)).toBeLessThan(.2);
  }
});

it('preserves visible power under off-grid relativistic frequency shifts', () => {
  const table = buildHotFlowTables(flow, rg);
  for (const row of [0, 12, 32]) for (const g of [.43, .93, 1.7]) {
    const at = (Math.log2(g) - HOT_LOG_SHIFT_MIN) / (HOT_LOG_SHIFT_MAX - HOT_LOG_SHIFT_MIN) * (HOT_SHIFT_COUNT - 1);
    const lo = Math.floor(at), f = at - lo;
    const logY = table.emission[(row * HOT_SHIFT_COUNT + lo) * 4 + 3] * (1-f)
      + table.emission[(row * HOT_SHIFT_COUNT + lo + 1) * 4 + 3] * f;
    // Independent observed-wavelength quadrature verifies units and g^3.
    const exact = spectrumToXyz(nm => {
      const wavelengthM = nm * 1e-9;
      const j = sampleHotSpectrum(table.model.shells[row].emission, C_LIGHT / wavelengthM / g);
      return g**3 * j * C_LIGHT / wavelengthM**2 * 1e-9 * rg * 100
        * table.model.powerScale / HOT_VISIBLE_REFERENCE;
    });
    expect(Math.abs(2**logY / exact.y - 1)).toBeLessThan(.03);
  }
});

it('lets weak flows fade without cooling them to a red blackbody or normalizing their peaks', () => {
  const bright = buildHotFlowTables(flow, rg);
  const weak = buildHotFlowTables(accretionFlowFor(mass, .5, 1e-9), rg);
  const peak = (data: Float32Array) => Math.max(...Array.from(data).filter((_, i) => i % 4 === 3));
  expect(peak(weak.emission)).toBeLessThan(peak(bright.emission) - 5);
  expect(weak.model.shells[0].plasma.electronTemperatureK).toBeGreaterThan(5e8);
});

it('bounds texture memory and disposes each renderer’s textures independently', () => {
  const a = createHotFlowSpectrum(flow, rg), b = createHotFlowSpectrum(flow, rg);
  expect(a.data).toBe(b.data);
  expect(a.emission).not.toBe(b.emission);
  expect(a.data.emission.byteLength + a.data.absorption.byteLength).toBe(61440);
  expect(a.data.emission.every(Number.isFinite)).toBe(true);
  expect(a.data.absorption.every(Number.isFinite)).toBe(true);
  let disposed = 0;
  a.emission.addEventListener('dispose', () => disposed++);
  a.absorption.addEventListener('dispose', () => disposed++);
  a.local.addEventListener('dispose', () => disposed++);
  a.dispose();
  expect(disposed).toBe(3);
  expect(a.response.pixels.byteLength).toBe(5299200);
  b.dispose();
});

it('matches directly recomputed local plasma spectra within the perturbation domain',()=>{
  const base=buildHotFlowTables(flow,rg),response=buildHotResponseTables(base,rg);
  const layer=HOT_RESPONSE_RADII*HOT_RESPONSE_SHIFTS*4;
  for(const row of [0,5,11])for(const changes of [[.1,.08,.1,.3],[-.15,-.12,-.1,-.4],[0,0,0,Math.log(2)]]) {
    const p={...response.shells[row].plasma};
    p.electronDensityCm3*=Math.exp(changes[0]);p.electronTemperatureK*=Math.exp(changes[1]);p.theta*=Math.exp(changes[1]);p.magneticGauss*=Math.exp(changes[2]);
    const exact=hotShellSpectrum(p,.01*Math.exp(changes[3]));
    const xyz=spectrumToXyz(nm=>sampleHotSpectrum(exact.emission,C_LIGHT/(nm*1e-9))*C_LIGHT/(nm*1e-9)**2*1e-9*rg*100*base.model.powerScale/HOT_VISIBLE_REFERENCE);
    const rgb=gamutMap(xyzToLinearSrgb(xyz));
    for(let c=0;c<3;c++) {
      const x=6/9*(HOT_RESPONSE_SHIFTS-1),lo=Math.floor(x),fraction=x-lo;
      const log=interpolateHotParameters(changes.map((v,i)=>hotGridCoordinate(Math.exp(v),i)),l=>{
        const at=2*l*layer+(row*HOT_RESPONSE_SHIFTS+lo)*4+c;
        return response.pixels[at]*(1-fraction)+response.pixels[at+4]*fraction;
      });
      // This bounded material approximation targets 20% per visible band
      // for simultaneous parameter changes, not precision spectroscopy.
      expect(Math.abs(2**log/rgb[c]-1),`row ${row}, channel ${c}, changes ${changes}`).toBeLessThan(.2);
    }
  }
});

it('keeps cooling interpolation consistent with the shader and the dynamic field bounded',()=>{
  const data=buildHotFlowTables(flow,rg),response=buildHotResponseTables(data,rg);
  for(const coordinates of [[.25,.7,2.3,.2],[1.4,3.1,.3,1.7],[2,4,4,2]]) {
    const offset=5*HOT_RESPONSE_LAYERS;
    expect(sampleHotCooling(response.coolingResponse,offset,coordinates)).toBeCloseTo(
      interpolateHotParameters(coordinates,layer=>response.coolingResponse[offset+layer]),10);
  }
  const field=new HotFlowField(flow,rg,.5,data.model,response),version=field.texture.version;
  field.advance(0);expect(field.texture.version).toBe(version);
  field.advance(.01);expect(field.texture.version).toBeGreaterThan(version);
  expect(field.radiationScale).toBeGreaterThan(0);
  expect(field.radiationScale).toBeLessThanOrEqual(1);
  const pixels=field.texture.image.data as Float32Array;
  expect(pixels.every((v,i)=>Number.isFinite(v)&&v>=0&&v<=(i%4===1||i%4===2?4:2))).toBe(true);
  let disposed=false;field.texture.addEventListener('dispose',()=>{disposed=true;});field.dispose();expect(disposed).toBe(true);
});
