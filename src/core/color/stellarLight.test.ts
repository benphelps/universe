import { stellarOpticalResponse } from './stellarOpticalResponse';
import { expect,it } from 'vitest';
import { stellarBandRgb,splitStellarLight } from './stellarLight';
import { blackbodyOpticalRgb,rgbLuminance } from './optical';
it('retains optical power and hue against direct Planck integration across all model temperatures',()=>{
  let worst=0;
  for(let i=0;i<800;i++) {
    const temperature=200*Math.exp(i/799*Math.log(1e7/200)),expected=blackbodyOpticalRgb(temperature),actual=stellarBandRgb(1,temperature);
    const power=rgbLuminance(expected),error=actual.reduce((s,v,c)=>s+Math.abs(v-expected[c]),0);
    if(power>1e-12)worst=Math.max(worst,error/power);
    expect(actual.every(v=>v>=0&&Number.isFinite(v))).toBe(true);
    expect(rgbLuminance(actual)).toBeLessThanOrEqual(stellarOpticalResponse.maxFraction);
    const split=splitStellarLight(actual);
    for(let c=0;c<3;c++)expect(split.color[c]*split.luminosity).toBeCloseTo(actual[c],14);
  }
  expect(worst).toBeLessThan(.00001);
});
it('scales luminosity linearly and does not replace dark or invalid sources with a visibility floor',()=>{
  const light=stellarBandRgb(1,5772);
  stellarBandRgb(3,5772).forEach((v,c)=>expect(v).toBeCloseTo(light[c]*3,14));
  for(const [l,t] of [[0,5772],[1,0],[NaN,5772],[1,Infinity]])expect(stellarBandRgb(l,t)).toEqual([0,0,0]);
  expect(rgbLuminance(stellarBandRgb(1,900))).toBeLessThan(1e-5);
});
