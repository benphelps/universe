import { expectedCloudField } from './clouds';
import { DUST_OPACITY_PER_PC, SMOOTH_MODEL, dustDensity, armBoost, type GalacticPosition } from './density';

/** The near discrete-cloud tier and the statistical cloud field occupy
 * disjoint path intervals. Smooth intercloud dust spans the whole path. */
export const LOCAL_CLOUD_RADIUS_PC = 1500;
/** Defer the seed-dependent arm normalization until the session is set. */
export function globalCloudField(): number { return expectedCloudField(1,1); }

/** Bounded optical-depth quadrature. Within each side of the midplane,
 * integrate the exponential vertical profile analytically and sample
 * equal vertical-column intervals. A long grazing ray cannot skip the
 * 120-pc dust layer. Radial/arm variation remains sampled (up to 12 nodes
 * per interval); this is the same statistical far-cloud law as the sky. */
export function globalDustOpticalDepth(from: GalacticPosition,to: GalacticPosition,stepsPerInterval=12): number {
  const cloudField=globalCloudField();
  const dx=to.xPc-from.xPc,dy=to.yPc-from.yPc,dz=to.zPc-from.zPc;
  const distance=Math.hypot(dx,dy,dz);
  if(!(distance>1e-9))return 0;
  const dir=[dx/distance,dy/distance,dz/distance];
  const crossing=Math.abs(dir[2])>1e-12?-from.zPc/dir[2]:-1;
  const bounds=[0,distance];
  if(distance>LOCAL_CLOUD_RADIUS_PC)bounds.push(LOCAL_CLOUD_RADIUS_PC);
  if(crossing>0&&crossing<distance)bounds.push(crossing);
  bounds.sort((a,b)=>a-b);
  const height=SMOOTH_MODEL.dustScaleHeightPc;
  let depth=0;
  for(let segment=1;segment<bounds.length;segment++) {
    const lo=bounds[segment-1],hi=bounds[segment],span=hi-lo;
    if(!(span>0))continue;
    const z0=from.zPc+dir[2]*lo,z1=from.zPc+dir[2]*hi;
    const w0=Math.exp(-Math.abs(z0)/height),w1=Math.exp(-Math.abs(z1)/height);
    const slope=-(Math.abs(z1)-Math.abs(z0))/height/span;
    const column=Math.abs(slope*span)<1e-6?span*(w0+w1)/2:(w1-w0)/slope;
    if(!(column>1e-20))continue;
    const count=Math.min(stepsPerInterval,Math.max(1,Math.ceil(span/120)));
    for(let i=0;i<count;i++) {
      const t=(i+.5)/count;
      const w=w0*(1-t)+w1*t;
      const side=z0+z1>=0?1:-1;
      const s=Math.abs(slope*span)<1e-6?lo+span*t:(-side*height*Math.log(w)-from.zPc)/dir[2];
      const p={xPc:from.xPc+dir[0]*s,yPc:from.yPc+dir[1]*s,zPc:from.zPc+dir[2]*s};
      const dust=dustDensity(p);
      const radius=Math.hypot(p.xPc,p.yPc);
      const clump=s>LOCAL_CLOUD_RADIUS_PC?.45+1.6*cloudField*dust*(.4+.6*armBoost(radius,Math.atan2(p.yPc,p.xPc))):.45;
      depth+=dust/Math.max(1e-30,w)*clump*column/count;
    }
  }
  return depth*DUST_OPACITY_PER_PC;
}
