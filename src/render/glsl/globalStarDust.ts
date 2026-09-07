import { DUST_OPACITY_PER_PC,SMOOTH_MODEL } from '../../universe/galaxy/density';
import { ARM_LUT_RADIUS_MIN_PC,ARM_LUT_RADIUS_MAX_PC } from '../../universe/galaxy/armLut';
import { LOCAL_CLOUD_RADIUS_PC } from '../../universe/galaxy/globalDust';
import { glslFloat as f } from './format';

export const GLOBAL_STAR_DUST_GLSL = `
uniform sampler2D uStarArmLut;
uniform float uGlobalDustEnabled;
uniform float uStarCloudField;
uniform vec3 uStarDustObserverPc;
vec2 starDustArm(vec3 p) {
  float radius=length(p.xy);
  if(radius<${f(ARM_LUT_RADIUS_MIN_PC)})return vec2(0.0);
  return texture2D(uStarArmLut,vec2(atan(p.y,p.x)/6.283185307179586,
    log(radius/${f(ARM_LUT_RADIUS_MIN_PC)})/${f(Math.log(ARM_LUT_RADIUS_MAX_PC/ARM_LUT_RADIUS_MIN_PC))})).rg;
}
float starDustInterval(vec3 origin,vec3 dir,float lo,float hi) {
  float span=hi-lo;
  if(span<=0.0)return 0.0;
  float height=${f(SMOOTH_MODEL.dustScaleHeightPc)};
  float z0=origin.z+dir.z*lo,z1=origin.z+dir.z*hi;
  float w0=exp(-abs(z0)/height),w1=exp(-abs(z1)/height);
  float slope=-(abs(z1)-abs(z0))/height/span;
  bool levelRay=abs(slope*span)<1e-5;
  float column=levelRay?span*(w0+w1)*.5:(w1-w0)/slope;
  if(column<=1e-20)return 0.0;
  int count=min(12,max(1,int(ceil(span/120.0))));
  float tau=0.0;
  for(int i=0;i<12;i++) {
    if(i>=count)break;
    float t=(float(i)+.5)/float(count),w=mix(w0,w1,t);
    float side=z0+z1>=0.0?1.0:-1.0;
    float s=levelRay?lo+span*t:(-side*height*log(w)-origin.z)/dir.z;
    vec3 p=origin+dir*s;
    vec2 arm=starDustArm(p);
    float radial=exp(-length(p.xy)/${f(SMOOTH_MODEL.dustScaleLengthPc)})*(1.0+${f(SMOOTH_MODEL.dustLaneWeight)}*arm.y);
    float dust=radial*w;
    float clump=s>${f(LOCAL_CLOUD_RADIUS_PC)}?.45+1.6*uStarCloudField*dust*(.4+.6*(1.0+arm.x)):.45;
    tau+=radial*clump*column/float(count);
  }
  return tau*${f(DUST_OPACITY_PER_PC)};
}
float starGlobalOpticalDepth(vec3 origin,vec3 relPc) {
  float reach=length(relPc);
  if(uGlobalDustEnabled<.5||reach<1e-9)return 0.0;
  vec3 dir=relPc/reach;
  float plane=abs(dir.z)>1e-12?clamp(-origin.z/dir.z,0.0,reach):0.0;
  float local=min(reach,${f(LOCAL_CLOUD_RADIUS_PC)});
  float a=min(local,plane),b=max(local,plane);
  return starDustInterval(origin,dir,0.0,a)+starDustInterval(origin,dir,a,b)+starDustInterval(origin,dir,b,reach);
}
`;
