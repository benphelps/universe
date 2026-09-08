import { expect, it } from 'vitest';
import { regularKerrRay } from './regularKerr';

it('converges from every viewing inclination, including the spin axis and grazing rays', () => {
  let worst=0, steps=0;
  for(const spin of [0,.5,.89,.998,-.89]) for(const theta of [1e-8,.3,Math.PI/2,Math.PI-.3]) {
    for(const b of [0,2,4,4.8,5.2,6,8,12,20]) for(const phi of [0,.8,1.6,3.1]) {
      const tangent=b/28;
      const direction:[number,number,number]=[Math.sqrt(1-tangent*tangent),tangent*Math.cos(phi),tangent*Math.sin(phi)];
      const fast=regularKerrRay(28,theta,direction,spin);
      const reference=regularKerrRay(28,theta,direction,spin,.0125);
      expect(fast.captured).toBe(reference.captured);
      if(!fast.captured){
        const error=Math.hypot(...fast.direction.map((v,i)=>v-reference.direction[i]));
        worst=Math.max(worst,error);expect(error).toBeLessThan(.0005);
      }
      expect(Math.abs(fast.angularError)).toBeLessThan(.0001);
      steps=Math.max(steps,fast.steps);
    }
  }
  expect(worst).toBeLessThan(.0005);
  expect(steps).toBeLessThan(256);
});

it('matches independent Schwarzschild radial quadrature through a complete turning point',()=>{
  for(const localB of [5.1,5.5,6,8,12,20]){
    const tangent=localB/28;
    const ray=regularKerrRay(28,Math.PI/2,[Math.sqrt(1-tangent*tangent),0,tangent],0);
    expect(ray.captured).toBe(false);
    const b2=ray.ray.xi**2+ray.ray.eta;
    let lo=0,hi=1/3;
    for(let i=0;i<60;i++){
      const u=(lo+hi)/2;
      if(1-b2*u*u+2*b2*u*u*u>0)lo=u;else hi=u;
    }
    const turn=(lo+hi)/2;
    const integrate=(end:number)=>{
      const n=2048,h=end/n;
      let sum=0;
      for(let i=0;i<=n;i++){
        const t=i*h,u=turn-t*t;
        const value=2/Math.sqrt(turn+u-2*(turn*turn+turn*u+u*u));
        sum+=value*(i===0||i===n?1:i%2?4:2);
      }
      return sum*h/3;
    };
    const angle=integrate(Math.sqrt(turn))+integrate(Math.sqrt(turn-1/28));
    const expected=[Math.cos(angle),-Math.sin(angle),0];
    expect(Math.hypot(...ray.direction.map((v,i)=>v-expected[i]))).toBeLessThan(.0005);
  }
});
