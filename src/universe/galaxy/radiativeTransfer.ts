import { cellEmissionWeight as columnEscape } from '../../core/physics/radiativeTransfer';
export { columnEscape };

/** Total Klein–Nishina cross section relative to Thomson, photon energy in
 * electron-rest-energy units. The series avoids cancellation at optical energy.
 */
export function kleinNishinaRatio(x:number):number {
  if(x<1e-3)return 1-2*x+5.2*x*x;
  const log=Math.log1p(2*x);
  return .75*((1+x)/x**3*(2*x*(1+x)/(1+2*x)-log)+log/(2*x)-(1+3*x)/(1+2*x)**2);
}

/** Local isotropic source iteration on a uniform log-frequency grid.
 * Direct emissivity is retained; extinction is applied by the ray only once.
 * Photons in each order escape, are absorbed, or feed the next scattering order.
 * Redistribution deposits photon number between neighbouring bins, with weights
 * linear in frequency so mean photon energy is preserved as well.
 */
export function localScatteringSource(seed:Float64Array,absorption:Float64Array,
  scattering:Float64Array,frequencies:Float64Array,length:number,
  shiftedFrequency:(frequency:number)=>number,orders=3) {
  const source=seed.slice(),escape=new Float64Array(seed.length),scatterFraction=new Float64Array(seed.length);
  const dlog=Math.log(frequencies[1]/frequencies[0]);
  for(let i=0;i<seed.length;i++) {
    const extinction=absorption[i]+scattering[i];
    escape[i]=columnEscape(extinction*length);
    scatterFraction[i]=extinction>0?scattering[i]/extinction*(1-escape[i]):0;
  }
  let previous=seed;
  let outOfBandPhotons=0;
  for(let order=0;order<orders;order++) {
    const next=new Float64Array(seed.length);
    for(let i=0;i<seed.length;i++) {
      const photons=previous[i]*scatterFraction[i];
      if(photons===0)continue;
      const nu=shiftedFrequency(frequencies[i]);
      // Photons shifted outside the represented band leave this finite model.
      if(nu<frequencies[0]||nu>frequencies[seed.length-1]){outOfBandPhotons+=photons;continue;}
      const lo=Math.min(seed.length-2,Math.max(0,Math.floor(Math.log(nu/frequencies[0])/dlog)));
      const fraction=Math.max(0,Math.min(1,(nu-frequencies[lo])/(frequencies[lo+1]-frequencies[lo])));
      next[lo]+=photons*(1-fraction);next[lo+1]+=photons*fraction;
    }
    for(let i=0;i<seed.length;i++)source[i]+=next[i];
    previous=next;
  }
  let escapedPhotons=0,absorbedPhotons=0,unresolvedPhotons=0;
  for(let i=0;i<seed.length;i++) {
    escapedPhotons+=source[i]*escape[i];
    absorbedPhotons+=source[i]*Math.max(0,1-escape[i]-scatterFraction[i]);
    unresolvedPhotons+=previous[i]*scatterFraction[i];
  }
  return {source,escape,escapedPhotons,absorbedPhotons,unresolvedPhotons,outOfBandPhotons};
}
