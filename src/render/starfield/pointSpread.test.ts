import { expect, it } from 'vitest';
import { pointSpreadCdf, pointSpreadWeight } from './pointSpread';
it('partitions the full source at every pixel phase and detector scale', () => {
  for(const scale of [.25,.4,.711111,1,1.777777,2,4,8])for(let phase=0;phase<17;phase++) {
    let sum=0;
    for(let pixel=-40;pixel<=40;pixel++)sum+=pointSpreadWeight(pixel-phase/17,scale);
    expect(sum).toBeCloseTo(1,12);
  }
});
it('is symmetric, nonnegative, compact and continuous through the spline joins', () => {
  for(let x=-3;x<=3;x+=.007) {
    expect(pointSpreadCdf(x)+pointSpreadCdf(-x)).toBeCloseTo(1,14);
    expect(pointSpreadWeight(x,1)).toBeGreaterThanOrEqual(-1e-14);
  }
  for(const x of [-2,-1,0,1,2])expect(Math.abs(pointSpreadCdf(x+1e-8)-pointSpreadCdf(x-1e-8))).toBeLessThan(2e-8);
  expect(pointSpreadWeight(3,1)).toBe(0);
});
