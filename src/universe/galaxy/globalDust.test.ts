import {describe,it,expect} from 'vitest';
import {globalDustOpticalDepth,globalCloudField,LOCAL_CLOUD_RADIUS_PC} from './globalDust';
import {DUST_OPACITY_PER_PC,dustDensity,armBoost,SMOOTH_MODEL} from './density';

describe('global stellar dust columns',()=>{
  it('integrates steep vertical crossings without missing the disc',()=>{
    const height=SMOOTH_MODEL.dustScaleHeightPc;
    for(const r of [0,1000,8000,15000])for(const z of [300,5000,1e6]) {
      const start={xPc:r,yPc:0,zPc:-z},end={xPc:r,yPc:0,zPc:z};
      const midDust=dustDensity({xPc:r,yPc:0,zPc:0});
      const arm=armBoost(r,0);
      const integral=(lo:number,hi:number,k:number)=>{
        const primitive=(v:number)=>Math.sign(v)*height/k*(1-Math.exp(-Math.abs(v)*k/height));
        return primitive(hi)-primitive(lo);
      };
      const smooth=.45*midDust*integral(-z,z,1);
      const farStart=Math.min(z,-z+LOCAL_CLOUD_RADIUS_PC);
      const clouds=1.6*globalCloudField()*(.4+.6*arm)*midDust**2*integral(farStart,z,2);
      expect(globalDustOpticalDepth(start,end)/(DUST_OPACITY_PER_PC*(smooth+clouds))).toBeCloseTo(1,5);
    }
  });
  it('agrees with a dense independent midpoint integral on local and oblique rays',()=>{
    for(const [a,b] of [
      [[8000,0,80],[8040,20,100]],[[8000,0,80],[7800,100,-200]],
      [[8000,0,3000],[8000,1200,-3000]],[[8000,0,80],[7100,900,150]],
    ]) {
      const from={xPc:a[0],yPc:a[1],zPc:a[2]},to={xPc:b[0],yPc:b[1],zPc:b[2]};
      const distance=Math.hypot(...a.map((v,i)=>b[i]-v));
      let expected=0;
      for(let i=0;i<30000;i++) {
        const t=(i+.5)/30000,p={xPc:a[0]+(b[0]-a[0])*t,yPc:a[1]+(b[1]-a[1])*t,zPc:a[2]+(b[2]-a[2])*t};
        const dust=dustDensity(p),arm=armBoost(Math.hypot(p.xPc,p.yPc),Math.atan2(p.yPc,p.xPc));
        const clump=t*distance>LOCAL_CLOUD_RADIUS_PC?.45+1.6*globalCloudField()*dust*(.4+.6*arm):.45;
        expected+=dust*clump*distance/30000*DUST_OPACITY_PER_PC;
      }
      expect(Math.abs(Math.exp(-globalDustOpticalDepth(from,to))-Math.exp(-expected))).toBeLessThan(.004);
    }
  });
  it('has no column behind the source and no self-attenuation at zero distance',()=>{
    const origin={xPc:8000,yPc:0,zPc:80};
    expect(globalDustOpticalDepth(origin,origin)).toBe(0);
    let previous=0;
    for(const distance of [1,10,100,300,1000,1500,1501,2500,10000]) {
      const tau=globalDustOpticalDepth(origin,{...origin,xPc:8000-distance});
      expect(tau).toBeGreaterThan(previous);expect(Number.isFinite(tau)).toBe(true);previous=tau;
    }
  });
});
