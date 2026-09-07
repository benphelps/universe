import { SELECTION_AGE_BINS, SELECTION_POWER_BINS, SELECTION_AGE_CURVE, SELECTION_MIN_LOG_POWER, SELECTION_MAX_LOG_POWER } from '../../universe/galaxy/fieldSelectionGrid';
import { MIN_FAR_IRRADIANCE } from '../../universe/galaxy/skySurvey';
import { glslFloat as f } from './format';

/** Same positive cumulative selection ledger as the worker CPU. Only
 * the bounded local portion of a sky ray pays for these table reads. */
export const FIELD_SELECTION_GLSL = `
uniform sampler2D uFieldSelection;
uniform vec4 uSelectionScaleR;
uniform vec4 uSelectionScaleG;
uniform vec4 uSelectionScaleB;
uniform vec4 uSelectionCaps;
uniform vec4 uSelectionYoung;
uniform vec4 uSelectionOld;
uniform float uCensusPc;
vec3 fieldCdf(int component,int row,float age,float p) {
  if(age<=0.0)return vec3(0.0);
  float a=log(1.0+min(1.0,age)*${f(Math.expm1(SELECTION_AGE_CURVE))})*${f(SELECTION_AGE_BINS/SELECTION_AGE_CURVE)};
  a=clamp(a,0.0,${f(SELECTION_AGE_BINS)});
  ivec2 lo=ivec2(floor(vec2(p,a))),hi=min(lo+1,ivec2(${SELECTION_POWER_BINS},${SELECTION_AGE_BINS}));
  vec2 t=fract(vec2(p,a));
  int y=(component*4+row)*${SELECTION_AGE_BINS+1};
  return mix(mix(texelFetch(uFieldSelection,ivec2(lo.x,y+lo.y),0).rgb,texelFetch(uFieldSelection,ivec2(hi.x,y+lo.y),0).rgb,t.x),
    mix(texelFetch(uFieldSelection,ivec2(lo.x,y+hi.y),0).rgb,texelFetch(uFieldSelection,ivec2(hi.x,y+hi.y),0).rgb,t.x),t.y);
}
vec3 unresolvedFieldEmission(vec4 counts,float distancePc) {
  vec3 full=vec3(dot(counts,uPopulationR),dot(counts,uPopulationG),dot(counts,uPopulationB));
  if(distancePc<=uCensusPc)return vec3(0.0);
  float reach=1.5*max(max(uSelectionYoung.x,uSelectionYoung.y),max(uSelectionYoung.z,uSelectionYoung.w));
  if(distancePc>=max(reach,2.0*uCensusPc))return full;
  float census=clamp(2.0-distancePc/uCensusPc,0.0,1.0);
  float power=${f(MIN_FAR_IRRADIANCE)}*distancePc*distancePc;
  float p=clamp((log(max(power,1e-30))/log(10.0)-(${f(SELECTION_MIN_LOG_POWER)}))*${f(SELECTION_POWER_BINS/(SELECTION_MAX_LOG_POWER-SELECTION_MIN_LOG_POWER))},0.0,${f(SELECTION_POWER_BINS)});
  float total=dot(counts,vec4(1.0)),prior=0.0;
  vec3 selected=vec3(0.0);
  for(int component=0;component<4;component++) {
    float share=counts[component]/max(total,1e-30);
    if(share<=0.0)continue;
    vec3 scale=vec3(uSelectionScaleR[component],uSelectionScaleG[component],uSelectionScaleB[component]);
    for(int row=0;row<4;row++) {
      float young=uSelectionYoung[row]>0.0?clamp(3.0-2.0*distancePc/uSelectionYoung[row],0.0,1.0):census;
      float old=uSelectionOld[row]>0.0?clamp(3.0-2.0*distancePc/uSelectionOld[row],0.0,1.0):census;
      if(young<=0.0&&old<=0.0)continue;
      float yc=min(census,young),oc=min(census,old);
      float age=clamp((uSelectionCaps[row]-prior)/share,0.0,1.0);
      vec3 all=fieldCdf(component,row,1.0,${f(SELECTION_POWER_BINS)});
      vec3 ageAll=age>=1.0?all:fieldCdf(component,row,age,${f(SELECTION_POWER_BINS)});
      vec3 bright=max(vec3(0.0),all-fieldCdf(component,row,1.0,p));
      vec3 ageBright=age>=1.0?bright:max(vec3(0.0),ageAll-fieldCdf(component,row,age,p));
      vec3 value=all*oc+ageAll*(yc-oc)+bright*(old-oc)+ageBright*(young-yc-old+oc);
      selected+=counts[component]*scale*clamp(value,vec3(0.0),all);
    }
    prior+=share;
  }
  return max(vec3(0.0),full-selected);
}
`;
