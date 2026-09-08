import { C_LIGHT, K_B, PROTON_MASS } from '../../core/physics/constants';
import type { AccretionFlow } from './accretionFlow';
import { hotPlasmaAt, type HotPlasma } from './hotFlowEmission';
import { jetLoading, OUTFLOW, windLaunchEnergy } from './hotOutflow';

export type OutflowKind = 'wind' | 'jet';
export const JET_WIDTH=OUTFLOW.jetAngle**2/2;
/** Mean-one angular mass-flux profiles over the entire sphere. The wind
 * leaves the torus surface; the paired jets occupy its polar funnels. */
export function outflowAngular(kind:OutflowKind,mu:number):number {
  const m=Math.min(1,Math.abs(mu));
  return kind==='wind'?7.5*m*m*(1-m*m):Math.exp(-(1-m)/JET_WIDTH)/(JET_WIDTH*(-Math.expm1(-1/JET_WIDTH)));
}
export function outflowAt(flow:AccretionFlow,kind:OutflowKind,r:number) {
  const p=flow.outflows;
  if(!p)return {mass:0,beta:0,magneticW:0,electronW:0};
  if(kind==='jet') {
    const loading=jetLoading(p,r),gamma=1+(OUTFLOW.jetGamma-1)*(-Math.expm1(-Math.max(0,r-p.jetLaunchRg)/8));
    return {mass:p.jetMassKgPerS*loading,beta:Math.sqrt(1-1/(gamma*gamma)),
      magneticW:OUTFLOW.jetMagnetic*p.jetPowerW*loading,electronW:OUTFLOW.jetElectrons*p.jetPowerW*loading};
  }
  const inner=flow.rateKgPerS+p.jetMassKgPerS,x=Math.max(1,r/p.windLaunchRg);
  const mass=inner*Math.expm1(p.windIndex*Math.log(x)),energy=windLaunchEnergy(p,inner,r);
  return {mass,beta:mass>0?OUTFLOW.windSpeed*Math.sqrt(energy/(mass*C_LIGHT**2)):0,
    magneticW:OUTFLOW.windMagnetic*energy,electronW:OUTFLOW.windElectrons*energy};
}
/** Stationary quasi-spherical mass continuity and Poynting flux, interpreted
 * locally in the ZAMO frame. This prescribes collimation/heating, not GRMHD.
 * Temperatures cool with expansion; emission has a separate energy ceiling. */
export function outflowPlasma(flow:AccretionFlow,rgM:number,kind:OutflowKind,r:number,mu:number,temperatureScale:number):HotPlasma|null {
  const at=outflowAt(flow,kind,r),angular=outflowAngular(kind,mu);
  if(at.mass<=0||at.beta<=0||angular<=0)return null;
  const c=C_LIGHT*100,mp=PROTON_MASS*1000,kb=K_B*1e7,me=9.1093837e-28;
  const radiusCm=r*rgM*100,v=at.beta*c,gamma=1/Math.sqrt(1-at.beta**2);
  const electronDensityCm3=at.mass*1000*angular/(4*Math.PI*radiusCm**2*gamma*v*mp);
  const magneticGauss=Math.sqrt(at.magneticW*1e7*angular/(gamma**2*v*radiusCm**2));
  const launch=kind==='jet'?flow.outflows!.jetLaunchRg:flow.outflows!.windLaunchRg;
  const temperature=kind==='wind'?.6*hotPlasmaAt(flow,rgM,r).electronTemperatureK*temperatureScale
    :3e10*(r/launch)**-.7;
  // Relativistic electron enthalpy ~4kT: no particle receives more than the
  // prescribed heating power per particle, even at vanishing mass supply.
  const energyTemperature=at.electronW/at.mass*PROTON_MASS/(4*K_B);
  const electronTemperatureK=Math.max(1e4,Math.min(temperature,energyTemperature));
  return {radiusCm,heightCm:radiusCm*(kind==='jet'?OUTFLOW.jetAngle:.4),electronDensityCm3,
    electronTemperatureK,ionTemperatureK:0,magneticGauss,inflowSeconds:radiusCm/v,
    theta:kb*electronTemperatureK/(me*c*c)};
}
