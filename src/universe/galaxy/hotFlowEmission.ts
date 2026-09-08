import { C_LIGHT, H_PLANCK, K_B, PROTON_MASS, THOMSON_CROSS_SECTION } from '../../core/physics/constants';
import { hotInflowRate, outflowKey } from './hotOutflow';
import { kleinNishinaRatio, localScatteringSource } from './radiativeTransfer';
import type { AccretionFlow } from './accretionFlow';

// CGS throughout the emission calculation. See docs/model/hot-flow-emission.md.
const C = C_LIGHT * 100, H = H_PLANCK * 1e7, KB = K_B * 1e7;
const ME = 9.1093837e-28, MP = PROTON_MASS * 1000, E = 4.8032047e-10;
const SIGMA_T = THOMSON_CROSS_SECTION * 1e4;
export const HOT_FLOW_ASSUMPTIONS = Object.freeze({ viscosity: .1, plasmaBeta: 10,
  tailEnergyFraction: .01, tailIndex: 3.5, maximumLorentzFactor: 1e5 });

export interface HotPlasma {
  radiusCm: number;
  heightCm: number;
  electronDensityCm3: number;
  electronTemperatureK: number;
  ionTemperatureK: number;
  magneticGauss: number;
  inflowSeconds: number;
  theta: number;
}

/** A prescribed two-temperature closure, not a solved electron energy equation.
 * Number density obeys the same steady inflow and Gaussian height as the torus. */
export function hotPlasmaAt(flow: AccretionFlow, gravitationalRadiusM: number, radiusRg: number): HotPlasma {
  const radiusCm = radiusRg * gravitationalRadiusM * 100;
  const heightCm = flow.aspectRatio * radiusCm;
  const inflow = HOT_FLOW_ASSUMPTIONS.viscosity * C / Math.sqrt(radiusRg) * flow.aspectRatio ** 2;
  const electronDensityCm3 = hotInflowRate(flow, radiusRg) * 1000 / (2*Math.PI*Math.sqrt(2*Math.PI)*radiusCm*heightCm*inflow*MP);
  const ionTemperatureK = MP*C*C / (3*KB*radiusRg);
  const electronTemperatureK = Math.min(ionTemperatureK, 3e10,
    Math.max(1e9, 1.2e10 * (radiusRg/10)**-.3 / (1+Math.sqrt(flow.eddingtonRatio/.001))));
  const magneticGauss = Math.sqrt(8*Math.PI*electronDensityCm3*KB*(ionTemperatureK+electronTemperatureK)
    / HOT_FLOW_ASSUMPTIONS.plasmaBeta);
  return { radiusCm, heightCm, electronDensityCm3, electronTemperatureK, ionTemperatureK,
    magneticGauss, inflowSeconds: radiusCm/inflow, theta: KB*electronTemperatureK/(ME*C*C) };
}

const KERNEL_MIN = -12, KERNEL_MAX = Math.log(80), KERNEL_SIZE = 512;
let kernel: Float64Array | undefined;
/** F(x)=x integral_x^infinity K_(5/3)(t) dt. Swapping the Bessel integral
 * gives a positive, rapidly convergent quadrature; no fitted color/spectrum. */
export function synchrotronKernel(x: number): number {
  if (!(x > 0) || x >= 80) return 0;
  if (Math.log(x) < KERNEL_MIN) return 2.1495282415 * Math.cbrt(x);
  if (!kernel) {
    kernel = Float64Array.from({ length: KERNEL_SIZE }, (_, i) => {
      const at = Math.exp(KERNEL_MIN+(KERNEL_MAX-KERNEL_MIN)*i/(KERNEL_SIZE-1));
      const extent = Math.max(5, Math.log(40/at)+1), steps=160, du=extent/steps;
      let integral=0;
      for(let j=0;j<=steps;j++) {
        const u=j*du, cosh=Math.cosh(u);
        integral+=(j===0||j===steps?1:j%2?4:2)*Math.exp(-at*cosh)*Math.cosh(5*u/3)/cosh;
      }
      return Math.log(Math.max(1e-100, at*integral*du/3));
    });
  }
  const index=(Math.log(x)-KERNEL_MIN)/(KERNEL_MAX-KERNEL_MIN)*(KERNEL_SIZE-1);
  const lo=Math.min(KERNEL_SIZE-2,Math.floor(index)), f=index-lo;
  return Math.exp(kernel[lo]*(1-f)+kernel[lo+1]*f);
}

interface ElectronBin { gamma: number; thermal: number; tail: number; tailSlope: number }
export interface ElectronPopulation { bins: ElectronBin[]; thermalEnergy: number; tailEnergy: number; tailNumber: number }
/** Number-conserving Maxwell–Jüttner core plus a cooled power-law tail.
 * The tail owns 1% of electron kinetic energy, not 1% of the particle count. */
export function hotElectrons(plasma: HotPlasma, tailFraction: number = HOT_FLOW_ASSUMPTIONS.tailEnergyFraction): ElectronPopulation {
  const bins: ElectronBin[]=[];
  const theta=plasma.theta, n=plasma.electronDensityCm3;
  let coreCount=0, coreEnergy=0, tailCount=0, tailEnergy=0;
  const min=.0001, max=40*theta, step=Math.log(max/min)/64;
  for(let i=0;i<64;i++) {
    const kinetic=min*Math.exp((i+.5)*step), gamma=1+kinetic;
    const weight=gamma*Math.sqrt(gamma*gamma-1)*Math.exp(-kinetic/theta)*kinetic*step;
    bins.push({gamma,thermal:weight,tail:0,tailSlope:0}); coreCount+=weight; coreEnergy+=weight*kinetic;
  }
  const gammaMin=Math.max(2,1+2*theta), gammaMax=HOT_FLOW_ASSUMPTIONS.maximumLorentzFactor;
  const tailStep=Math.log(gammaMax/gammaMin)/80, p=HOT_FLOW_ASSUMPTIONS.tailIndex;
  const coolingBreak=6*Math.PI*ME*C/(SIGMA_T*plasma.magneticGauss**2*plasma.inflowSeconds);
  for(let i=0;i<80;i++) {
    const gamma=gammaMin*Math.exp((i+.5)*tailStep);
    const weight=gamma**(-p)/(1+gamma/coolingBreak)*gamma*tailStep;
    bins.push({gamma,thermal:0,tail:weight,tailSlope:p+gamma/(coolingBreak+gamma)});
    tailCount+=weight; tailEnergy+=weight*(gamma-1);
  }
  const meanCore=coreEnergy/coreCount, meanTail=tailEnergy/tailCount;
  const fraction=Math.max(0,Math.min(.1,tailFraction));
  const tailN=n*fraction*meanCore/((1-fraction)*meanTail+fraction*meanCore);
  for(const bin of bins) {bin.thermal*=(n-tailN)/coreCount;bin.tail*=tailN/tailCount;}
  return {bins,thermalEnergy:(n-tailN)*meanCore*ME*C*C,tailEnergy:tailN*meanTail*ME*C*C,tailNumber:tailN};
}

/** Electron-ion plus electron-electron bolometric cooling fit, Narayan & Yi
 * (1995), as collected by Mahadevan (1997), eqs. 27–28. */
export function bremsstrahlungPower(plasma: HotPlasma): number {
  const t=plasma.theta;
  const f=t<1
    ? 4*Math.sqrt(2*t/Math.PI**3)*(1+1.781*t**1.34)+1.73*t**1.5*(1+1.1*t+t*t-1.25*t**2.5)
    : 9*t/(2*Math.PI)*(Math.log(1.123*t+.48)+1.5)+2.30*t*(Math.log(1.123*t)+1.28);
  return 1.48e-22*plasma.electronDensityCm3**2*f;
}

export interface PlasmaSpectrum { synchrotron: number; bremsstrahlung: number; absorption: number }
/** Comoving j_nu in erg s^-1 cm^-3 sr^-1 Hz^-1 and alpha_nu in cm^-1.
 * Continuous synchrotron, isotropic representative pitch angle; cyclotron
 * harmonics and polarization are unresolved. Free-free has an exponential
 * shape with its relativistic bolometric normalization. */
export function plasmaSpectrum(plasma: HotPlasma, electrons: ElectronPopulation, frequencyHz: number): PlasmaSpectrum {
  const b=plasma.magneticGauss*Math.sqrt(2/3);
  const critical=3*E*b/(4*Math.PI*ME*C);
  const coefficient=Math.sqrt(3)*E**3*b/(ME*C*C);
  let thermal=0,tail=0,tailAbs=0;
  for(const bin of electrons.bins) {
    const power=coefficient*(1-1/bin.gamma**2)*synchrotronKernel(frequencyHz/(critical*bin.gamma**2));
    thermal+=power*bin.thermal; tail+=power*bin.tail;
    tailAbs+=power*bin.tail*(bin.tailSlope+2)/bin.gamma;
  }
  thermal/=4*Math.PI; tail/=4*Math.PI;
  tailAbs/=8*Math.PI*ME*frequencyHz**2;
  const cutoff=H/(KB*plasma.electronTemperatureK);
  const bremsstrahlung=bremsstrahlungPower(plasma)*cutoff*Math.exp(-frequencyHz*cutoff)/(4*Math.PI);
  const planck=2*H*frequencyHz**3/(C*C)/Math.expm1(Math.min(700,frequencyHz*cutoff));
  const absorption=(thermal+bremsstrahlung)/Math.max(planck,1e-200)+tailAbs;
  return {synchrotron:thermal+tail,bremsstrahlung,absorption};
}

export const HOT_FREQUENCY_MIN = 1e7, HOT_FREQUENCY_MAX = 1e23, HOT_FREQUENCY_COUNT = 256;
export interface HotShellSpectrum {
  plasma: HotPlasma;
  emission: Float64Array;
  absorption: Float64Array;
  emittedPower: number;
  /** Luminosity escaping a representative vertical column. */
  escapedPower: number;
  /** Fraction of seed photon number still scattering after the final local order. */
  scatteringRemainderFraction: number;
}
/** Interpolate positive spectra logarithmically, including exponentially faint tails. */
export function sampleHotSpectrum(values: ArrayLike<number>, frequencyHz: number): number {
  if(frequencyHz<HOT_FREQUENCY_MIN||frequencyHz>HOT_FREQUENCY_MAX)return 0;
  const index=Math.log(frequencyHz/HOT_FREQUENCY_MIN)/Math.log(HOT_FREQUENCY_MAX/HOT_FREQUENCY_MIN)*(values.length-1);
  const lo=Math.min(values.length-2,Math.max(0,Math.floor(index))),f=index-lo;
  return Math.exp(Math.log(Math.max(values[lo],1e-200))*(1-f)+Math.log(Math.max(values[lo+1],1e-200))*f);
}

export function hotShellSpectrum(plasma: HotPlasma, tailFraction: number = HOT_FLOW_ASSUMPTIONS.tailEnergyFraction): HotShellSpectrum {
  const electrons=hotElectrons(plasma,tailFraction), emission=new Float64Array(HOT_FREQUENCY_COUNT),absorption=new Float64Array(HOT_FREQUENCY_COUNT);
  const seed=new Float64Array(HOT_FREQUENCY_COUNT);
  const dlog=Math.log(HOT_FREQUENCY_MAX/HOT_FREQUENCY_MIN)/(HOT_FREQUENCY_COUNT-1);
  const length=Math.sqrt(2*Math.PI)*plasma.heightCm;
  for(let i=0;i<seed.length;i++) {
    const nu=HOT_FREQUENCY_MIN*Math.exp(i*dlog),s=plasmaSpectrum(plasma,electrons,nu);
    seed[i]=s.synchrotron+s.bremsstrahlung;absorption[i]=s.absorption;
  }
  // Isotropic local scattering source, distinct from direct emission. The
  // ray applies extinction once. A representative column supplies the local
  // radiation field; no spatial/global Compton transport is implied.
  const frequencies=Float64Array.from({length:seed.length},(_,i)=>HOT_FREQUENCY_MIN*Math.exp(i*dlog));
  const scattering=frequencies.map(nu=>plasma.electronDensityCm3*SIGMA_T
    *kleinNishinaRatio(H*nu/(ME*C*C)*(1+3*plasma.theta)));
  const boost=1+4*plasma.theta+16*plasma.theta**2;
  // Soft-photon mean gain with a recoil turnover toward the electron energy.
  // This is a reduced redistribution kernel, not exact thermal Comptonization.
  const recoil=(boost-1)/(3*Math.max(plasma.theta,1e-12));
  const transfer=localScatteringSource(seed,absorption,scattering,frequencies,length,
    nu=>nu*boost/(1+recoil*H*nu/(ME*C*C)));
  emission.set(transfer.source);
  let emittedPower=0,escapedPower=0;
  for(let i=0;i<seed.length;i++) {
    const weight=i===0||i===seed.length-1?.5:1;
    emittedPower+=4*Math.PI*emission[i]*frequencies[i]*dlog*weight;
    escapedPower+=4*Math.PI*emission[i]*transfer.escape[i]*frequencies[i]*dlog*weight;
  }
  const seedPhotons=seed.reduce((sum,j)=>sum+j,0);
  return {plasma,emission,absorption,emittedPower,escapedPower,
    scatteringRemainderFraction:transfer.unresolvedPhotons/Math.max(seedPhotons,1e-200)};
}

export interface HotFlowModel {
  shells: HotShellSpectrum[];
  powerScale: number;
  electronTemperatureScale: number;
  emittedLuminosityW: number;
  escapedLuminosityW: number;
  budgetW: number;
}
export const HOT_RADIUS_COUNT = 48;
/** A global electron-heating closure: lower the prescribed temperature when
 * its escaping luminosity exceeds the supplied budget. Reabsorbed synchrotron
 * photons recycle energy internally and are not charged as cooling twice.
 * A residual cap at the temperature floor bounds cases outside this closure. */
function computeHotFlowModel(flow: AccretionFlow, gravitationalRadiusM: number, count=HOT_RADIUS_COUNT): HotFlowModel {
  const base=Array.from({length:count},(_,i)=>hotPlasmaAt(flow,gravitationalRadiusM,
    flow.innerRadiusRg*(flow.outerRadiusRg/flow.innerRadiusRg)**(i/(count-1))));
  const dlog=Math.log(flow.outerRadiusRg/flow.innerRadiusRg)/(count-1);
  const evaluate=(temperatureScale:number):HotFlowModel=>{
    const shells=base.map(p=>{
      const electronTemperatureK=Math.max(5e8,p.electronTemperatureK*temperatureScale);
      const magneticGauss=p.magneticGauss*Math.sqrt((p.ionTemperatureK+electronTemperatureK)/(p.ionTemperatureK+p.electronTemperatureK));
      return hotShellSpectrum({...p,electronTemperatureK,theta:KB*electronTemperatureK/(ME*C*C),magneticGauss});
    });
    let power=0,escaped=0;
    for(let i=0;i<shells.length;i++) {
      const s=shells[i],volume=2*Math.PI*s.plasma.radiusCm**2*Math.sqrt(2*Math.PI)*s.plasma.heightCm*dlog*(i===0||i===count-1?.5:1);
      power+=s.emittedPower*volume;escaped+=s.escapedPower*volume;
    }
    const powerScale=Math.min(1,flow.luminosityW*1e7/Math.max(escaped,1e-200));
    return {shells,powerScale,electronTemperatureScale:temperatureScale,emittedLuminosityW:power*powerScale/1e7,
      escapedLuminosityW:escaped*powerScale/1e7,budgetW:flow.luminosityW};
  };
  const initial=evaluate(1);
  if(initial.powerScale===1)return initial;
  let lo=.01,hi=1,best=evaluate(lo);
  if(best.powerScale<1)return best;
  for(let i=0;i<7;i++) {
    const mid=Math.sqrt(lo*hi),candidate=evaluate(mid);
    if(candidate.powerScale<1)hi=mid;
    else {lo=mid;best=candidate;}
  }
  return best;
}

const modelCache=new Map<string,HotFlowModel>();
function modelKey(flow:AccretionFlow,rgM:number):string {
  return [rgM,flow.innerRadiusRg,flow.outerRadiusRg,flow.rateKgPerS,flow.eddingtonRatio,flow.aspectRatio,flow.luminosityW,outflowKey(flow)].join(':');
}
/** Install a worker-built reference model for the information panel. */
export function rememberHotFlowModel(flow:AccretionFlow,rgM:number,model:HotFlowModel):void {
  modelCache.set(modelKey(flow,rgM),model);
  if(modelCache.size>2)modelCache.delete(modelCache.keys().next().value!);
}
export function hotFlowModelIfReady(flow:AccretionFlow,rgM:number):HotFlowModel|null {
  return modelCache.get(modelKey(flow,rgM))??null;
}
export function buildHotFlowModel(flow:AccretionFlow,rgM:number,count=HOT_RADIUS_COUNT):HotFlowModel {
  const key=modelKey(flow,rgM);
  if(count===HOT_RADIUS_COUNT&&modelCache.has(key))return modelCache.get(key)!;
  const model=computeHotFlowModel(flow,rgM,count);
  if(count===HOT_RADIUS_COUNT) {
    modelCache.set(key,model);
    if(modelCache.size>2)modelCache.delete(modelCache.keys().next().value!);
  }
  return model;
}
