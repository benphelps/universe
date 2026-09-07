import { glslFloat as f } from '../glsl/format';
import { CONTINUUM_SHADOW_STEPS } from '../../universe/galaxy/nebulaContinuum';
import { DUST_OPACITY_PER_PC, HG_G } from '../../universe/galaxy/density';
import { SCATTER_OPACITY_RGB } from '../../universe/galaxy/dustScattering';

export const CONTINUUM_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
uniform sampler3D uField;
uniform sampler2D uSources;
uniform int uSourceCount;
uniform int uSize;
uniform int uCols;
uniform float uBoxPc;
uniform float uCellPc;
uniform float uDustRef;
out vec4 outCell;
void main() {
  ivec2 pixel=ivec2(gl_FragCoord.xy), tile=pixel/uSize;
  int layer=tile.y*uCols+tile.x;
  if(layer>=2*uSize) { outCell=vec4(0); return; }
  bool moment=layer>=uSize;
  vec3 p=(vec3(pixel%uSize,layer%uSize)+0.5)*2.0*uBoxPc/float(uSize)-uBoxPc;
  vec3 intensity=vec3(0), direction=vec3(0);
  float weight=0.0, floorR2=pow(uBoxPc/float(uSize),2.0);
  const vec3 opacity=vec3(${SCATTER_OPACITY_RGB.map(f).join(',')});
  for(int s=0;s<uSourceCount;s++) {
    vec4 source=texelFetch(uSources,ivec2(0,s),0), color=texelFetch(uSources,ivec2(1,s),0);
    vec3 delta=p-source.xyz;
    float r=length(delta), entry=0.0;
    for(int axis=0;axis<3;axis++) if(abs(source[axis])>uBoxPc)
      entry=max(entry,((source[axis]<0.0?-uBoxPc:uBoxPc)-source[axis])/delta[axis]);
    float path=r*(1.0-entry);
    int steps=min(${CONTINUUM_SHADOW_STEPS},max(1,int(ceil(path/(2.0*uCellPc)))));
    float tau=0.0;
    for(int step=0;step<${CONTINUUM_SHADOW_STEPS};step++) {
      if(step>=steps) break;
      float t=entry+(1.0-entry)*(float(step)+0.5)/float(steps);
      tau+=texture(uField,(source.xyz+delta*t+uBoxPc)/(2.0*uBoxPc)).r*uDustRef*${f(DUST_OPACITY_PER_PC)}*path/float(steps);
      if(tau>28.0) break;
    }
    vec3 value=source.w/max(floorR2,r*r)*color.rgb*opacity*exp(-tau*opacity);
    intensity+=value;
    float y=dot(value,vec3(0.2126,0.7152,0.0722)); weight+=y;
    if(r>0.0) direction+=y*delta/r;
  }
  outCell=vec4(moment?(weight>0.0?direction/weight:vec3(0)):intensity,0);
}
`;

/** Packed pair: two slabs per domain, coarse then fine. Clamp within
 * each slab so trilinear filtering never crosses into the next field. */
export const CONTINUUM_SAMPLE_GLSL = `
vec3 continuumCoord(vec3 uvw,float size,float slab) {
  vec3 c=clamp(uvw,vec3(0.5/size),vec3(1.0-0.5/size));
  return vec3(c.xy,(c.z+slab)*0.25);
}
float continuumPhase(vec3 moment,vec3 view) {
  float norm=length(moment), g=${f(HG_G)}*min(1.0,norm);
  float mu=norm>1e-6?-dot(moment,view)/norm:0.0;
  return (1.0-g*g)/pow(1.0+g*g-2.0*g*mu,1.5);
}
`;
