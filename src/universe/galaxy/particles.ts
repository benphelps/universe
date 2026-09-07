import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { SMOOTH_MODEL } from './density';
import { spiralAzimuthSampler } from './spiralSampling';
import { galaxyRoot } from './galaxySeed';
import { surfaceRadiusSampler } from './radialSampling';
import { overviewPopulationTable as population } from './overviewPopulationTable';

/** Statistical samples of the thin disc's optical bright tail. They are
 * light elements without catalogue identities, not decorative emitters.
 * The diffuse renderer debits the expected selected population first. */
export interface GalaxyParticleSet {
  count: number;
  positionsPc: Float32Array;
  /** Intrinsic optical power RGB, L☉, before any instrument or extinction. */
  opticalRgb: Float32Array;
  expectedRgb: readonly [number,number,number];
  realizedRgb: [number,number,number];
  /** Selected RGB power per parent thin-disc object, within radiusPc. */
  selectedMeanRgb: [number,number,number];
  radiusPc: number;
}
import { OVERVIEW_RADIUS_PC } from './overviewSurvey';
let cached: GalaxyParticleSet | null = null;
export function getGalaxyParticles(): GalaxyParticleSet {
  if (cached) return cached;
  const rng = new Rng(deriveSeed(galaxyRoot(0x47414c58n), 'galaxy-particles'));
  const radial = surfaceRadiusSampler(r => Math.exp(-r / SMOOTH_MODEL.thinScaleLengthPc), OVERVIEW_RADIUS_PC);
  const azimuth = spiralAzimuthSampler();
  const count = population.count, positionsPc = new Float32Array(count*3), opticalRgb = new Float32Array(count*3);
  const realizedRgb: [number,number,number] = [0,0,0];
  for (let i=0;i<count;i++) {
    const radius=radial(rng.float()), theta=azimuth(radius,rng.float()), height=rng.float()-.5;
    positionsPc[i*3]=radius*Math.cos(theta);positionsPc[i*3+1]=radius*Math.sin(theta);
    positionsPc[i*3+2]=-SMOOTH_MODEL.thinScaleHeightPc*Math.sign(height)*Math.log(1-2*Math.abs(height));
    // Stratify the luminosity-function CDF independently of position.
    const bin=Math.min(population.bins.length-1,Math.floor((i+rng.float())/count*population.bins.length));
    for(let c=0;c<3;c++){opticalRgb[i*3+c]=population.bins[bin][c];realizedRgb[c]+=opticalRgb[i*3+c];}
  }
  return cached={count,positionsPc,opticalRgb,expectedRgb:population.expectedRgb,realizedRgb,
    selectedMeanRgb:population.expectedRgb.map(v=>v/population.parentCount) as [number,number,number],radiusPc:OVERVIEW_RADIUS_PC};
}
