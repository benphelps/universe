import { C_LIGHT,K_B } from '../../core/physics/constants';
import { createPeriodicPerlin3 } from '../../core/noise/periodic3';
import { hotInflowRate } from './hotOutflow';
import type { AccretionFlow } from './accretionFlow';
import { hotElectrons, type HotFlowModel } from './hotFlowEmission';

export const HOT_FIELD_RADII = 32, HOT_FIELD_AZIMUTHS = 96;
const TAU = 2 * Math.PI;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface Reservoirs { thermal: number; magnetic: number; tail: number }
export interface HeatingRates {
  drive: number;
  dissipation: number;
  thermalCooling: number;
  tailCooling: number;
  acceleration: number;
}

/** Positive reservoir transfer. Magnetic work is the only source; accelerated
 * particles receive a share of released energy. Cooling cannot overspend.
 * The returned radiation closes the local energy ledger exactly. */
export function heatPlasma(state: Reservoirs, rates: HeatingRates, dt: number) {
  const supplied = Math.max(0, rates.drive) * dt;
  const magnetic = (state.magnetic + supplied) * Math.exp(-rates.dissipation * dt);
  const released = state.magnetic + supplied - magnetic;
  const accelerated = released * clamp(rates.acceleration, 0, 1);
  const hot = state.thermal + released - accelerated, tail = state.tail + accelerated;
  const thermal = hot * Math.exp(-rates.thermalCooling * dt);
  const energetic = tail * Math.exp(-rates.tailCooling * dt);
  return { thermal, magnetic, tail: energetic, supplied,
    radiated: hot - thermal + tail - energetic };
}

/** Conservative upwind transport of a perturbation relative to a steady
 * steady inflow. Radial coefficients include the outer-face mass flux;
 * inward transport plus outflow loss removes local specific reservoirs. Azimuth is periodic, outer supply is 1,
 * and the inner boundary drains. CFL is enforced by HotFlowDynamics. */
export function transportHotField(
  source: Float32Array, target: Float32Array, radial: Float64Array,
  angular: Float64Array, dt: number, radii = HOT_FIELD_RADII, azimuths = HOT_FIELD_AZIMUTHS,
  faceVelocity?:Float64Array,
): void {
  for (let r = 0; r < radii; r++) for (let p = 0; p < azimuths; p++) {
    const i = (r * azimuths + p) * 4;
    const behind = (r * azimuths + (p + azimuths - 1) % azimuths) * 4;
    const outside = i + azimuths * 4;
    const outgoingSpeed=angular[r]*(faceVelocity?.[i/4]??1);
    const incomingSpeed=angular[r]*(faceVelocity?.[behind/4]??1);
    const outsideDensity=r+1<radii?source[outside]:1;
    target[i]=source[i]+dt*(radial[r]*(outsideDensity-source[i])+incomingSpeed*source[behind]-outgoingSpeed*source[i]);
    for (let c = 1; c < 4; c++) {
      const value=source[i]*source[i+c];
      const incoming = r + 1 < radii ? outsideDensity*source[outside+c] : 1;
      target[i+c] = (value + dt * (radial[r] * (incoming-value)
        + incomingSpeed*source[behind]*source[behind+c]-outgoingSpeed*value))/target[i];
    }
  }
}

/** A small 2-D model of vertically coherent plasma columns. Four channels
 * carry density and specific thermal/magnetic/tail energies relative to the
 * radial equilibrium. It evolves perturbations, not a GRMHD fluid solution.
 * All time is in displayed inner orbits, preserving the viewer's time cap. */
export class HotFlowDynamics {
  readonly state = new Float32Array(HOT_FIELD_RADII * HOT_FIELD_AZIMUTHS * 4);
  readonly thermalResponse = new Float64Array(HOT_FIELD_RADII*2);
  private readonly scratch = new Float32Array(this.state.length);
  private readonly radial = new Float64Array(HOT_FIELD_RADII);
  private readonly angular = new Float64Array(HOT_FIELD_RADII);
  private readonly cooling = new Float64Array(HOT_FIELD_RADII);
  private readonly magneticEnergy = new Float64Array(HOT_FIELD_RADII);
  private readonly tailEnergy = new Float64Array(HOT_FIELD_RADII);
  private readonly phase = new Float64Array(HOT_FIELD_RADII * HOT_FIELD_AZIMUTHS);
  private readonly orbitRate = new Float64Array(HOT_FIELD_RADII);
  private readonly faceVelocity = new Float64Array(HOT_FIELD_RADII*HOT_FIELD_AZIMUTHS).fill(1);
  private readonly maxStep: number;
  time = 0;
  version = 0;
  lastUpdateMs = 0;
  lastSubsteps = 0;

  constructor(flow: AccretionFlow, rgM: number, spin: number, model: HotFlowModel) {
    const logRange = Math.log(flow.outerRadiusRg / flow.innerRadiusRg), dx = logRange / HOT_FIELD_RADII;
    const period = TAU * (flow.innerRadiusRg**1.5 + spin) * rgM / C_LIGHT;
    const noise=createPeriodicPerlin3(BigInt(Math.trunc(rgM))^BigInt(Math.round(spin*1e6)),16);
    let maximumRate = 0;
    for (let r = 0; r < HOT_FIELD_RADII; r++) {
      const radius = flow.innerRadiusRg * Math.exp((r+.5)*dx);
      const shell = model.shells[Math.min(model.shells.length-1, Math.round((r+.5)/HOT_FIELD_RADII*(model.shells.length-1)))];
      const electrons = hotElectrons(shell.plasma);
      const colder=hotElectrons({...shell.plasma,theta:shell.plasma.theta*Math.exp(-.08)});
      const hotter=hotElectrons({...shell.plasma,theta:shell.plasma.theta*Math.exp(.08)});
      const slope=Math.log(hotter.thermalEnergy/colder.thermalEnergy)/.16;
      this.thermalResponse[r*2]=1/slope;
      this.thermalResponse[r*2+1]=(shell.plasma.electronDensityCm3-electrons.tailNumber)*K_B*1e7*shell.plasma.electronTemperatureK/electrons.thermalEnergy/slope;
      this.magneticEnergy[r] = shell.plasma.magneticGauss**2 / (8*Math.PI) / electrons.thermalEnergy;
      this.tailEnergy[r] = electrons.tailEnergy / electrons.thermalEnergy;
      // Cooling is based on escaping energy, so reabsorbed synchrotron does
      // not drain the cells twice. The tail cools ten times faster in this
      // reduced two-reservoir approximation, with equilibrium heating split.
      this.cooling[r] = period * shell.escapedPower * model.powerScale
        / Math.max(electrons.thermalEnergy * (1+10*this.tailEnergy[r]), 1e-100);
      this.orbitRate[r] = (flow.innerRadiusRg**1.5+spin)/(radius**1.5+spin);
      this.angular[r] = HOT_FIELD_AZIMUTHS * this.orbitRate[r];
      this.radial[r] = .1 * flow.aspectRatio**2 * period*C_LIGHT/rgM
        / (radius**1.5 * dx) * hotInflowRate(flow,radius*Math.exp(dx/2))/hotInflowRate(flow,radius);
      maximumRate = Math.max(maximumRate, this.radial[r]+1.08*this.angular[r]);
      for (let p=0; p<HOT_FIELD_AZIMUTHS; p++) {
        const phi = TAU*(p+.5)/HOT_FIELD_AZIMUTHS, angle = phi + 2.3*Math.log(radius);
        const pattern = 1.6*noise(2.5*Math.log(radius),3*Math.cos(angle),3*Math.sin(angle));
        const i = (r*HOT_FIELD_AZIMUTHS+p)*4;
        this.phase[i/4] = 3*angle+pattern*2;
        this.state[i] = Math.exp(.18*pattern);
        this.state[i+1] = 1+.06*pattern;
        this.state[i+2] = 1+.18*pattern;
        this.state[i+3] = 1;
      }
      let mean=0;
      for(let p=0;p<HOT_FIELD_AZIMUTHS;p++)mean+=this.state[(r*HOT_FIELD_AZIMUTHS+p)*4]/HOT_FIELD_AZIMUTHS;
      for(let p=0;p<HOT_FIELD_AZIMUTHS;p++)this.state[(r*HOT_FIELD_AZIMUTHS+p)*4]/=mean;
    }
    this.maxStep = .7 / maximumRate;
  }

  advance(deltaOrbits: number): boolean {
    if (!(deltaOrbits > 0)) return false;
    const started = performance.now();
    // The renderer already caps this interval. Also bound direct callers:
    // hidden tabs and huge time jumps must never create a catch-up backlog.
    const interval = Math.min(deltaOrbits, .02), steps = Math.ceil(interval / this.maxStep), dt = interval / steps;
    for (let step=0; step<steps; step++) {
      transportHotField(this.state, this.scratch, this.radial, this.angular, dt,HOT_FIELD_RADII,HOT_FIELD_AZIMUTHS,this.faceVelocity);
      this.time += dt;
      for (let r=0; r<HOT_FIELD_RADII; r++) {
        const cool = this.cooling[r], mb = this.magneticEnergy[r], nb = this.tailEnergy[r];
        const basePower = cool*(1+10*nb), baseTailShare = 10*nb/(1+10*nb);
        for (let p=0; p<HOT_FIELD_AZIMUTHS; p++) {
          const i=(r*HOT_FIELD_AZIMUTHS+p)*4;
          const rho=this.scratch[i];
          // Slowly evolving shear work replenishes magnetic energy. This is
          // bounded forcing, not a claim to resolve magnetic instability.
          const phase=this.phase[i/4]-TAU*this.time*this.orbitRate[r]*2.6;
          // Compressive velocity fluctuations move mass through faces rather
          // than creating/deleting density. The mean rotation stays prograde.
          this.faceVelocity[i/4]=1+.08*Math.sin(phase);
          const drive=1+.3*Math.sin(phase)*Math.sin(.37*phase+this.time*.2);
          // Stronger-than-equilibrium field releases its stored energy more
          // quickly and allocates a larger share to accelerated electrons.
          const stress=clamp((this.scratch[i+2]-1.04)/.16,0,1);
          const release=1+2*stress*stress;
          const result=heatPlasma({thermal:this.scratch[i+1],magnetic:this.scratch[i+2]*mb,tail:this.scratch[i+3]*nb},
            {drive:basePower*drive,dissipation:basePower/mb*release,
              thermalCooling:cool*Math.sqrt(rho),tailCooling:10*cool*this.scratch[i+2],
              acceleration:Math.min(.25,baseTailShare+.12*stress)},dt);
          this.state[i]=rho;
          this.state[i+1]=result.thermal;
          this.state[i+2]=result.magnetic/mb;
          this.state[i+3]=result.tail/nb;
        }
      }
    }
    this.version++;
    this.lastSubsteps=steps;
    this.lastUpdateMs=performance.now()-started;
    return true;
  }
}
