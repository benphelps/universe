import { createPeriodicPerlin3 } from '../../core/noise/periodic3';
import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import type { AccretionFlow } from './accretionFlow';

export const THIN_DISK_RADII = 64, THIN_DISK_AZIMUTHS = 128;
export const THIN_DISK_STEP = 1 / 240;
const TAU = 2 * Math.PI, ALPHA = .1;
const DRIVING_SPACING=.22, MODES=[3,6,9,12];
const minmod = (a:number,b:number) => a*b>0 ? Math.sign(a)*Math.min(Math.abs(a),Math.abs(b)) : 0;

/** Conservative, monotone orbital remap. Integer rotation is exact; a
 * limited linear reconstruction moves the fractional cell without the
 * rapid numerical fading of first-order upwind rotation. Periodic in phi.
 * Channels are surface density, thermal reservoir, and heating stress,
 * all extensive quantities relative to the steady radial background. */
export function rotateDiskRing(source:Float32Array,target:Float32Array,offset:number,cells:number,shift:number):void {
  const whole=Math.floor(shift),fraction=shift-whole;
  const correction=.5*fraction*(1-fraction);
  for(let p=0;p<cells;p++) {
    const at=((p-whole)%cells+cells)%cells;
    const previous=(at+cells-1)%cells, before=(at+cells-2)%cells, next=(at+1)%cells;
    for(let c=0;c<3;c++) {
      const a=source[offset+at*4+c],b=source[offset+previous*4+c];
      const sa=minmod(a-b,source[offset+next*4+c]-a);
      const sb=minmod(b-source[offset+before*4+c],a-b);
      target[offset+p*4+c]=(1-fraction)*a+fraction*b+correction*(sb-sa);
    }
  }
}

/** Positive thermal relaxation with an explicit local energy ledger.
 * The prescribed stress supplies orbital work; radiation drains the
 * reservoir on t_th = 1/(alpha Omega). This is a cooling closure, not a
 * vertical atmosphere or radiation-pressure instability calculation. */
export function thinDiskEnergy(energy:number,heating:number,coolingFraction:number):number {
  return energy+(heating-energy)*coolingFraction;
}

/** Inward finite-volume flux around a steady constant mass supply.
 * rates[r] = common mass flux / equilibrium ring mass. The outer supply
 * is unperturbed and the ISCO boundary drains. The thermal/stress channels
 * transport perturbations about their own radial equilibria; this is not
 * an absolute relativistic energy or angular-momentum conservation law. */
export function driftDisk(source:Float32Array,target:Float32Array,rates:Float64Array,dt:number,azimuths=THIN_DISK_AZIMUTHS):void {
  const radii=rates.length;
  for(let r=0;r<radii;r++)for(let p=0;p<azimuths;p++) {
    const i=(r*azimuths+p)*4, outside=i+azimuths*4;
    for(let c=0;c<3;c++)target[i+c]=source[i+c]+dt*rates[r]*((r+1<radii?source[outside+c]:1)-source[i+c]);
  }
}

/** Subsonic compressive motion associated with unresolved stress variations.
 * Shared face fluxes move all reservoirs and conserve each ring's totals.
 * The perturbation is capped at 0.8% of orbital speed (< H/R here). */
export function compressDiskRing(source:Float32Array,target:Float32Array,offset:number,cells:number,rate:number,dt:number):void {
  // (stress-density)/(stress+density) is a bounded compressive closure.
  const velocity=(p:number)=>{
    const i=offset+p*4,rho=source[i],stress=source[i+2];
    return .008*cells*rate*(stress-rho)/(stress+rho);
  };
  for(let p=0;p<cells;p++) {
    const previous=(p+cells-1)%cells,next=(p+1)%cells;
    const incoming=velocity(previous),outgoing=velocity(p);
    for(let c=0;c<3;c++) {
      const fluxIn=incoming*source[offset+(incoming>=0?previous:p)*4+c];
      const fluxOut=outgoing*source[offset+(outgoing>=0?p:next)*4+c];
      target[offset+p*4+c]=source[offset+p*4+c]+dt*(fluxIn-fluxOut);
    }
  }
}

/** Two overlapping orbital packets renew without changing sign or
 * popping at a generation boundary. Ages stay in [0,2] local orbits;
 * spatial bandwidth cannot grow with total elapsed time. */
export function diskDrivingCoefficients(seed:number,localTime:number,target:Float64Array,offset=0):void {
  const phase=(generation:number,mode:number)=>{
    let x=seed^Math.imul(generation,0x9e3779b9)^Math.imul(mode+1,0x85ebca6b);
    x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);
    return ((x^(x>>>16))>>>0)/0x100000000*TAU;
  };
  const generation=Math.floor(localTime),age=localTime-generation;
  const newer=Math.sin(Math.PI/2*age),older=Math.cos(Math.PI/2*age);
  for(let m=0;m<4;m++) {
    const n=phase(generation,m)-TAU*MODES[m]*age;
    const o=phase(generation-1,m)-TAU*MODES[m]*(age+1);
    target[offset+m*2]=newer*Math.cos(n)+older*Math.cos(o);
    target[offset+m*2+1]=-newer*Math.sin(n)-older*Math.sin(o);
  }
}

/** Seeded 2-D perturbation model on a prescribed thin accretion disk.
 * Rotation uses Kerr circular periods; slow radial drift uses alpha(H/R)^2.
 * Density, heat, and stress travel together, but heat has its own response
 * time. Smooth seeded forcing represents unresolved turbulent work. It
 * does not solve MRI, magnetic vectors, momentum, or disk thickness.
 * Fixed steps make a given displayed history independent of frame batching.
 */
export class ThinDiskDynamics {
  readonly state=new Float32Array(THIN_DISK_RADII*THIN_DISK_AZIMUTHS*4);
  readonly previous=new Float32Array(this.state.length);
  readonly orbitalRates=new Float64Array(THIN_DISK_RADII);
  readonly driftRates=new Float64Array(THIN_DISK_RADII);
  private readonly rotated=new Float32Array(this.state.length);
  private readonly scratch=new Float32Array(this.state.length);
  private readonly basis=new Float32Array(THIN_DISK_AZIMUTHS*8);
  private readonly bands:Float64Array;
  private readonly bandRates:Float64Array;
  private readonly bandSeeds:Uint32Array;
  private readonly radialBands=new Float64Array(THIN_DISK_RADII);
  private readonly weights=new Float64Array(8);
  private readonly drive=new Float64Array(THIN_DISK_AZIMUTHS);
  private pending=0;
  private ticks=0;
  version=0;
  lastUpdateMs=0;
  lastSubsteps=0;
  readonly initializationMs:number;

  constructor(flow:AccretionFlow,spin:number,seed:bigint) {
    const start=performance.now();
    const noise=createPeriodicPerlin3(deriveSeed(seed,'thin-disk-initial'),32);
    const rng=new Rng(deriveSeed(seed,'thin-disk-driving'));
    const logRange=Math.log(flow.outerRadiusRg/flow.innerRadiusRg),dx=logRange/THIN_DISK_RADII;
    const innerClock=flow.innerRadiusRg**1.5+spin;
    const count=Math.ceil(logRange/DRIVING_SPACING)+1;
    this.bands=new Float64Array(count*8);
    this.bandRates=new Float64Array(count);
    this.bandSeeds=new Uint32Array(count);
    for(let band=0;band<count;band++) {
      this.bandRates[band]=innerClock/((flow.innerRadiusRg*Math.exp(band*DRIVING_SPACING))**1.5+spin);
      this.bandSeeds[band]=Math.floor(rng.float()*0x100000000);
    }
    for(let p=0;p<THIN_DISK_AZIMUTHS;p++)for(let m=0;m<4;m++) {
      const angle=TAU*(p+.5)/THIN_DISK_AZIMUTHS*MODES[m];
      this.basis[p*8+m*2]=Math.cos(angle);
      this.basis[p*8+m*2+1]=Math.sin(angle);
    }
    for(let r=0;r<THIN_DISK_RADII;r++) {
      const logRadius=(r+.5)*dx, radius=flow.innerRadiusRg*Math.exp(logRadius);
      this.orbitalRates[r]=innerClock/(radius**1.5+spin);
      // Exact equilibrium shell mass for v_r = alpha h² c / sqrt(r).
      const lo=radius*Math.exp(-dx/2), hi=radius*Math.exp(dx/2);
      this.driftRates[r]=TAU*innerClock*ALPHA*flow.aspectRatio**2/((2/3)*(hi**1.5-lo**1.5));
      this.radialBands[r]=logRadius/DRIVING_SPACING;
      const sums=[0,0,0];
      for(let p=0;p<THIN_DISK_AZIMUTHS;p++) {
        const phi=TAU*(p+.5)/THIN_DISK_AZIMUTHS,angle=phi+1.8*logRadius;
        const pattern=noise(4*logRadius,3*Math.cos(angle),3*Math.sin(angle));
        const thermal=noise(4*logRadius+7,3*Math.cos(angle),3*Math.sin(angle));
        const i=(r*THIN_DISK_AZIMUTHS+p)*4;
        this.state[i]=Math.exp(flow.turbulenceSigma*pattern);
        this.state[i+1]=Math.exp(.4*pattern+.25*thermal);
        this.state[i+2]=Math.exp(.55*thermal);
        this.state[i+3]=1;
        for(let c=0;c<3;c++)sums[c]+=this.state[i+c]/THIN_DISK_AZIMUTHS;
      }
      for(let p=0;p<THIN_DISK_AZIMUTHS;p++)for(let c=0;c<3;c++)this.state[(r*THIN_DISK_AZIMUTHS+p)*4+c]/=sums[c];
    }
    this.previous.set(this.state);
    this.initializationMs=performance.now()-start;
  }

  private updateDriving():void {
    for(let b=0;b<this.bandRates.length;b++)
      diskDrivingCoefficients(this.bandSeeds[b],this.time*this.bandRates[b],this.bands,b*8);
  }

  get time():number {return this.ticks*THIN_DISK_STEP;}
  get interpolation():number {return Math.min(1,this.pending/THIN_DISK_STEP);}

  advance(orbits:number):boolean {
    this.lastSubsteps=0;
    if(!(orbits>0)||!Number.isFinite(orbits))return false;
    const start=performance.now();
    this.pending+=Math.min(orbits,.02);
    while(this.pending+1e-12>=THIN_DISK_STEP) {
      const dt=THIN_DISK_STEP;
      this.previous.set(this.state);
      for(let r=0;r<THIN_DISK_RADII;r++)rotateDiskRing(this.state,this.rotated,r*THIN_DISK_AZIMUTHS*4,
        THIN_DISK_AZIMUTHS,this.orbitalRates[r]*THIN_DISK_AZIMUTHS*dt);
      driftDisk(this.rotated,this.scratch,this.driftRates,dt);
      this.ticks++;
      this.updateDriving();
      for(let r=0;r<THIN_DISK_RADII;r++) {
        const rate=this.orbitalRates[r],thermalRate=TAU*ALPHA*rate;
        compressDiskRing(this.scratch,this.state,r*THIN_DISK_AZIMUTHS*4,THIN_DISK_AZIMUTHS,rate,dt);
        const band=this.radialBands[r],lo=Math.floor(band)*8,f=band-Math.floor(band);
        // Smooth overlap of finite-lived orbital packets. Adjacent rings
        // share a driver, but advect at their own rates: genuine shear.
        const weights=this.weights;
        for(let m=0;m<8;m++)weights[m]=this.bands[lo+m]*(1-f)+this.bands[lo+8+m]*f;
        let mean=0;
        for(let p=0;p<THIN_DISK_AZIMUTHS;p++) {
          const i=(r*THIN_DISK_AZIMUTHS+p)*4;
          let work=0;
          for(let m=0;m<8;m++)work+=weights[m]*this.basis[p*8+m];
          this.drive[p]=this.state[i]*Math.exp(.45*work);
          mean+=this.drive[p]/THIN_DISK_AZIMUTHS;
        }
        // Redistribute the fixed mean accretion heating around each ring.
        const stressBlend=-Math.expm1(-TAU*rate*dt),coolBlend=-Math.expm1(-thermalRate*dt);
        for(let p=0;p<THIN_DISK_AZIMUTHS;p++) {
          const i=(r*THIN_DISK_AZIMUTHS+p)*4;
          const oldStress=this.state[i+2];
          const stress=oldStress+(this.drive[p]/mean-oldStress)*stressBlend;
          this.state[i+2]=stress;
          this.state[i+1]=thinDiskEnergy(this.state[i+1],.5*(stress+oldStress),coolBlend);
        }
      }
      this.pending=Math.max(0,this.pending-dt);
      this.lastSubsteps++;
    }
    if(this.lastSubsteps)this.version++;
    this.lastUpdateMs=performance.now()-start;
    return this.lastSubsteps>0;
  }
}
