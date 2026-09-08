import { clampSpin, horizonRadiusRg, radiativeEfficiency } from '../../core/physics/blackHole';
import { C_LIGHT } from '../../core/physics/constants';
import type { AccretionFlow } from './accretionFlow';

/** Explicit closure parameters, not predictions of spin alone. phi is the
 * dimensionless horizon magnetic flux in the usual BZ normalization. */
export interface HotOutflowOptions { windIndex?: number; magneticFlux?: number }
export interface HotOutflowPlan {
  windIndex: number;
  windLaunchRg: number;
  jetLaunchRg: number;
  magneticFlux: number;
  jetPowerW: number;
  jetMassKgPerS: number;
  windMassKgPerS: number;
  outerSupplyKgPerS: number;
  windPowerW: number;
  windAvailableW: number;
}
export const OUTFLOW = Object.freeze({ windSpeed: .25, windMagnetic: .05, windElectrons: .20,
  jetGamma: 3, jetKinetic: .65, jetMagnetic: .30, jetElectrons: .05, jetAngle: .18 });
const c2=C_LIGHT*C_LIGHT;
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
export function jetLoading(plan:HotOutflowPlan,r:number):number {
  const x=clamp(r/plan.jetLaunchRg-1,0,1);return x*x*(3-2*x);
}
/** Integral of c²/r_launch over the mass launched inside r. */
export function windLaunchEnergy(plan:HotOutflowPlan,innerSupply:number,r:number):number {
  const x=Math.max(1,r/plan.windLaunchRg),s=plan.windIndex;
  return innerSupply*c2*s/plan.windLaunchRg * Math.expm1((s-1)*Math.log(x))/(s-1);
}
export function hotOutflowPlan(rate:number,efficiency:number,spin:number,outer:number,options:HotOutflowOptions={}):HotOutflowPlan {
  spin=clampSpin(spin);
  const magneticFlux=clamp(options.magneticFlux??10,0,50),omega=spin/(2*horizonRadiusRg(spin));
  const jetPowerW=.044/(4*Math.PI)*magneticFlux**2*omega**2*(1+1.38*omega**2-9.2*omega**4)*rate*c2;
  const jetMassKgPerS=OUTFLOW.jetKinetic*jetPowerW/((OUTFLOW.jetGamma-1)*c2);
  const windAvailableW=.5*Math.max(0,radiativeEfficiency(spin)-efficiency)*rate*c2;
  const plan:HotOutflowPlan={windIndex:0,windLaunchRg:8,jetLaunchRg:Math.max(3,1.5*horizonRadiusRg(spin)),
    magneticFlux,jetPowerW,jetMassKgPerS,windMassKgPerS:0,outerSupplyKgPerS:rate+jetMassKgPerS,windPowerW:0,windAvailableW};
  const coefficient=.5+.5*OUTFLOW.windSpeed**2+OUTFLOW.windMagnetic+OUTFLOW.windElectrons;
  let lo=0,hi=clamp(options.windIndex??.35,0,.7);
  for(let i=0;i<40;i++) {
    plan.windIndex=(lo+hi)/2;
    if(coefficient*windLaunchEnergy(plan,rate+jetMassKgPerS,outer)>windAvailableW)hi=plan.windIndex;
    else lo=plan.windIndex;
  }
  plan.windIndex=lo;
  plan.windMassKgPerS=(rate+jetMassKgPerS)*Math.expm1(lo*Math.log(Math.max(1,outer/plan.windLaunchRg)));
  plan.outerSupplyKgPerS+=plan.windMassKgPerS;
  plan.windPowerW=coefficient*windLaunchEnergy(plan,rate+jetMassKgPerS,outer);
  return plan;
}
/** Horizon rate is preserved. Gas lost to the jet and wind is supplied from
 * larger radii; removing it also removes its local specific reservoirs. */
export function hotInflowRate(flow:AccretionFlow,r:number):number {
  const p=flow.outflows;if(!p)return flow.rateKgPerS;
  return (flow.rateKgPerS+p.jetMassKgPerS*jetLoading(p,r))
    * Math.max(1,Math.min(r,flow.outerRadiusRg)/p.windLaunchRg)**p.windIndex;
}
export function outflowKey(flow:AccretionFlow):string {return JSON.stringify(flow.outflows??null);}
