import { expect,it } from 'vitest';
import { gravitationalRadius } from '../../core/physics/blackHole';
import { accretionFlowFor } from '../../universe/galaxy/accretionFlow';
import { hotShellSpectrum } from '../../universe/galaxy/hotFlowEmission';
import { outflowAt, outflowPlasma, JET_WIDTH } from '../../universe/galaxy/hotOutflowEmission';
import { receivedSample,receivedAbsorption } from './hotFlowSpectrum';
import { hotInflowRate } from '../../universe/galaxy/hotOutflow';
import { buildOutflowTable, outflowKinematics } from './hotOutflowSpectrum';
it('keeps spectra positive and finite, never fills unused heating power, and emits nothing before launch',()=>{
  for(const kind of ['wind','jet'] as const) {
    const f=accretionFlowFor(321000,.89,1e-5),table=buildOutflowTable(f,gravitationalRadius(321000),kind,.25);
    expect(table.pixels.every(x=>Number.isFinite(x)&&x>=0)).toBe(true);
    expect(table.emittedW).toBeGreaterThan(0);
    expect(table.emittedW).toBeLessThanOrEqual(table.budgetW*(1+1e-12));
    expect(table.powerScale).toBeLessThanOrEqual(1);
    expect(table.pixels.slice(0,46*4).every(x=>x===0)).toBe(true);
  }
},15000);
it('does not invent a jet when magnetic flux is zero',()=>{
  const table=buildOutflowTable(accretionFlowFor(321000,.89,1e-5,{magneticFlux:0}),gravitationalRadius(321000),'jet',.25);
  expect(table.pixels.every(x=>x===0)).toBe(true);expect(table.emittedW).toBe(0);
});

it('resolves held-out angular, radial and Doppler spectra against direct plasma integration',()=>{
  const f=accretionFlowFor(321000,.89,1e-5),rg=gravitationalRadius(321000);
  for(const kind of ['wind','jet'] as const) {
    const table=buildOutflowTable(f,rg,kind,.25);
    for(const [r,angular,g] of [[12,.3,.7],[22,.6,1.2],[39,.8,2.1]]) {
      const mu=kind==='jet'?1-angular*9*JET_WIDTH:angular;
      const p=outflowPlasma(f,rg,kind,r,mu,.25)!;
      const direct=receivedSample(hotShellSpectrum(p,kind==='jet'?.03:.01),g,rg*100,table.powerScale).map(v=>2**v);
      const extinction=receivedAbsorption(hotShellSpectrum(p,kind==='jet'?.03:.01),g,rg*100)
        .map(v=>2**v+p.electronDensityCm3*6.6524587e-25*rg*100);
      const sampledExtinction=[0,0,0];
      const coord=[(Math.log2(g)+6)/9*45,Math.log(r/table.launch)/Math.log(60/table.launch)*23,angular*19];
      const base=coord.map(Math.floor),frac=coord.map((v,i)=>v-base[i]),sample=[0,0,0,0];
      for(let bits=0;bits<8;bits++) {
        const x=bits&1,y=(bits>>1)&1,z=(bits>>2)&1;
        const weight=(x?frac[0]:1-frac[0])*(y?frac[1]:1-frac[1])*(z?frac[2]:1-frac[2]);
        const index=(((base[2]+z)*24+base[1]+y)*46+base[0]+x)*4;
        for(let c=0;c<4;c++)sample[c]+=table.pixels[index+c]*weight;
        for(let c=0;c<3;c++)sampledExtinction[c]+=table.pixels[table.pixels.length/2+index+c]*weight;
      }
      for(let c=0;c<3;c++)expect(Math.abs(sample[c]/direct[c]-1)).toBeLessThan(.3);
      for(let c=0;c<3;c++)expect(Math.abs(sampledExtinction[c]/extinction[c]-1)).toBeLessThan(.3);
    }
  }
},15000);

it('resolves steady velocity and density profiles without changing their physical values',()=>{
  const f=accretionFlowFor(321000,.89,1e-5),pixels=outflowKinematics(f);
  for(const r of [3.5,4.7,6.3,8.5,11,17,26,47,59]) {
    const at=Math.log(r/f.innerRadiusRg)/Math.log(60/f.innerRadiusRg)*255,lo=Math.floor(at),frac=at-lo;
    const direct=[outflowAt(f,'wind',r).beta,outflowAt(f,'jet',r).beta,hotInflowRate(f,r)/f.rateKgPerS];
    for(let c=0;c<3;c++) {
      const sampled=pixels[lo*4+c]*(1-frac)+pixels[(lo+1)*4+c]*frac;
      expect(Math.abs(sampled-direct[c])).toBeLessThan(.0005);
    }
  }
});
