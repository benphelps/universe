import { expect, it } from 'vitest';
import { criticalConstants } from '../../core/physics/kerr';
import { CAPTURE_TABLE_SIZE, createCaptureTable } from './captureTable';

it('brackets the analytic critical curve, including its maximum, across supported spins',()=>{
  for(const spin of [.01,.1,.5,.89,.998,-.998]){
    const table=createCaptureTable(spin),a=Math.abs(spin);
    const data=table.texture.image.data as Float32Array;
    const low=data[(CAPTURE_TABLE_SIZE-1)*2],high=data[0];
    for(let j=1;j<2000;j++){
      const r=low+(high-low)*j/2000;
      const critical=criticalConstants(r,a);
      const index=Math.min(CAPTURE_TABLE_SIZE-2,Math.max(0,Math.floor((critical.xi-table.range.x)/(table.range.y-table.range.x)*(CAPTURE_TABLE_SIZE-1))));
      const r0=data[index*2],r1=data[(index+1)*2];
      expect(r).toBeGreaterThanOrEqual(r1-3e-7);expect(r).toBeLessThanOrEqual(r0+3e-7);
      const min=Math.min(data[index*2+1],data[(index+1)*2+1]);
      const max=r1<=3&&r0>=3?27:Math.max(data[index*2+1],data[(index+1)*2+1]);
      expect(critical.eta).toBeGreaterThanOrEqual(min-.0001);expect(critical.eta).toBeLessThanOrEqual(max+.0001);
    }
    table.texture.dispose();
  }
});
