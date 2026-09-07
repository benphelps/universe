import {describe,it,expect} from 'vitest';
import {selectedFieldEmission,fieldSelectionData,fieldSelectionScales,SELECTION_WIDTH,SELECTION_HEIGHT,fieldSelectionRows} from './fieldSelection';
import {FIELD_COMPONENTS} from './fieldSelectionGrid';
import {fieldPopulationMoments} from './fieldPopulation';

describe('resolved and diffuse field light budget',()=>{
  it('has a positive monotone cumulative table and a small integration correction',()=>{
    const data=fieldSelectionData();
    expect(data.length).toBe(SELECTION_WIDTH*SELECTION_HEIGHT*3);
    let nonfinite=0,minimum=Infinity,monotoneError=0;
    for(let y=0;y<SELECTION_HEIGHT;y++)for(let x=0;x<SELECTION_WIDTH;x++)for(let c=0;c<3;c++) {
      const at=(y*SELECTION_WIDTH+x)*3+c,v=data[at];
      if(!Number.isFinite(v))nonfinite++;minimum=Math.min(minimum,v);
      if(x>0)monotoneError=Math.max(monotoneError,data[at-3]-v);
      if(y%65>0)monotoneError=Math.max(monotoneError,data[at-SELECTION_WIDTH*3]-v);
    }
    expect(nonfinite).toBe(0);expect(minimum).toBeGreaterThanOrEqual(-1e-12);expect(monotoneError).toBeLessThan(1e-7);
    for(const scale of fieldSelectionScales().flat())expect(Math.abs(scale-1)).toBeLessThan(.001);
  });
  it('partitions one component or any mixture without negative diffuse light',()=>{
    const mixes=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[.8,.1,.01,.09],[.01,.2,.7,.09]];
    for(const counts of mixes) {
      const full=[0,1,2].map(c=>counts.reduce((s,n,i)=>s+n*fieldPopulationMoments(FIELD_COMPONENTS[i]).opticalRgbSolar[c],0));
      for(const near of [1,10,30])for(const distance of [0,.5,1,5,10,29,30,45,60,90,120,150,225,300,600,900,1500,2500,3750,10000]) {
        const selected=selectedFieldEmission(counts,distance,near);
        for(let c=0;c<3;c++) {
          expect(selected[c]).toBeGreaterThanOrEqual(0);expect(selected[c]).toBeLessThanOrEqual(full[c]*(1+1e-6));
          if(distance<=near)expect(selected[c]/full[c]).toBeCloseTo(1,6);
          if(distance>=3750)expect(selected[c]).toBe(0);
        }
      }
    }
  });
  it('keeps a bounded far survey for luminous companions of old primaries',()=>{
    const rows=fieldSelectionRows();
    for(const row of rows.filter(r=>r.cap<1)) {
      expect(row.oldPc).toBeGreaterThan(60);
      expect(row.oldPc).toBeLessThanOrEqual(150);
    }
  });
});
