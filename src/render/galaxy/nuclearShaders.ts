import { NUCLEAR_COLUMN_LOG, NUCLEAR_CORE, NUCLEAR_TRUNCATION } from '../../universe/galaxy/nuclearProfile';
import { AIR_VIEW_GLSL } from '../lighting/airView';
import { TRANSFER_GLSL } from '../displayTransfer';

export const NUCLEAR_QUAD_VERTEX = /* glsl */`
out vec2 vUv;
uniform vec4 uTile;
void main() {
  vUv = position.xy * .5 + .5;
  vec2 ndc = (uTile.xy + vUv * uTile.zw) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 1e-24, 1.0);
}`;
export const NUCLEAR_TILE_VERTEX = /* glsl */`
out vec2 vUv;
void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy,0.0,1.0); }
`;

export const NUCLEAR_COLUMN_GLSL = /* glsl */`
uniform sampler2D uColumn;
uniform vec2 uColumnSize;
float columnAt(float impact, float z) {
  if (impact >= ${NUCLEAR_TRUNCATION.toFixed(1)} || z <= 0.0) return 0.0;
  vec2 p = clamp(log(vec2(impact,z) / ${NUCLEAR_CORE} + 1.0) / ${NUCLEAR_COLUMN_LOG},0.0,1.0) * (uColumnSize-1.0);
  ivec2 lo = ivec2(floor(p)), hi = min(lo+1,ivec2(uColumnSize)-1);
  vec2 f = fract(p);
  return mix(mix(texelFetch(uColumn,lo,0).r,texelFetch(uColumn,ivec2(hi.x,lo.y),0).r,f.x),
    mix(texelFetch(uColumn,ivec2(lo.x,hi.y),0).r,texelFetch(uColumn,hi,0).r,f.x),f.y);
}
float forwardColumn(vec3 observer, vec3 dir, float cut) {
  float impact = length(cross(observer,dir)), z = dot(observer,dir);
  if (impact >= ${NUCLEAR_TRUNCATION.toFixed(1)}) return 0.0;
  float end = sqrt(${(NUCLEAR_TRUNCATION**2).toFixed(1)}-impact*impact);
  if (z >= end) return 0.0;
  float result = columnAt(impact,end) - sign(z) * columnAt(impact,min(abs(z),end));
  if (cut > impact && z < -end) result -= 2.0 * columnAt(impact,sqrt(max(0.0,cut*cut-impact*impact)));
  return max(0.0,result);
}`;

export const NUCLEAR_SMOOTH_FRAGMENT = /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform vec4 uTile;
uniform vec2 uFocal;
uniform vec2 uTargetSize;
uniform vec3 uObserverPc;
uniform vec2 uScales;
uniform vec2 uCuts;
uniform vec3 uUnresolved0;
uniform vec3 uUnresolved1;
uniform vec2 uCentrePixel;
uniform float uRefineCentre;
${NUCLEAR_COLUMN_GLSL}
void main() {
  vec3 sum = vec3(0.0);
  // Pixel-area quadrature of the extended field. The central subpixel
  // luminosity is deposited by the normalized point kernel instead.
  bool refine=uRefineCentre>.5 && length(gl_FragCoord.xy-uCentrePixel)<5.0;
  vec4 nodes=refine ? vec4(-.4305681558,-.1699905218,.1699905218,.4305681558) : vec4(-.2886751346,.2886751346,0.0,0.0);
  vec4 weights=refine ? vec4(.1739274226,.3260725774,.3260725774,.1739274226) : vec4(.5,.5,0.0,0.0);
  int count=refine?4:2;
  for (int y=0;y<4;y++) { if(y>=count)break; for (int x=0;x<4;x++) { if(x>=count)break;
    vec2 uv = uTile.xy + (vUv + vec2(nodes[x],nodes[y]) / uTargetSize) * uTile.zw;
    vec3 dir = normalize(vec3((uv*2.0-1.0)/uFocal,-1.0));
    sum += weights[x]*weights[y]*uUnresolved0 * forwardColumn(uObserverPc/uScales.x,dir,uCuts.x) / (12.566370614359172*uScales.x*uScales.x);
    sum += weights[x]*weights[y]*uUnresolved1 * forwardColumn(uObserverPc/uScales.y,dir,uCuts.y) / (12.566370614359172*uScales.y*uScales.y);
  }}
  fragColor = vec4(sum,0.0);
}`;

export const NUCLEAR_POINT_VERTEX = /* glsl */`
in vec3 starPosition; in vec3 starRgb;
uniform float uPcKm;
uniform float uWeight;
uniform vec4 uTile;
uniform vec2 uTargetSize;
out vec2 vPixelOffset;
flat out vec3 vFlux;
void main() {
  vec3 view = (modelViewMatrix * vec4(starPosition,1.0)).xyz / uPcKm;
  float d2 = max(dot(view,view),1e-24);
  vec4 clip = projectionMatrix * vec4(view,1.0);
  if (clip.w <= 0.0) { gl_Position=vec4(2.0,2.0,0.0,1.0); vFlux=vec3(0.0); vPixelOffset=vec2(0.0); return; }
  vec2 uv = clip.xy/clip.w*.5+.5;
  vec2 tile = (uv-uTile.xy)/uTile.zw;
  vPixelOffset = position.xy*2.0;
  gl_Position = vec4((tile*2.0-1.0 + vPixelOffset*2.0/uTargetSize)*clip.w,0.0,clip.w);
  vFlux = starRgb * uWeight / (12.566370614359172*d2);
}`;
export const NUCLEAR_POINT_FRAGMENT = /* glsl */`
in vec2 vPixelOffset; flat in vec3 vFlux;
out vec4 fragColor;
uniform vec4 uTile; uniform vec2 uTargetSize; uniform vec2 uFocal;
float kernel(float x) { float a=abs(x); return a<1.0 ? 2.0/3.0-a*a+.5*a*a*a : (a<2.0 ? pow(2.0-a,3.0)/6.0 : 0.0); }
void main() {
  vec2 plane = ((uTile.xy + gl_FragCoord.xy/uTargetSize*uTile.zw)*2.0-1.0)/uFocal;
  float solidAngle = 4.0*uTile.z*uTile.w/(uTargetSize.x*uTargetSize.y*uFocal.x*uFocal.y*pow(1.0+dot(plane,plane),1.5));
  fragColor = vec4(vFlux*kernel(vPixelOffset.x)*kernel(vPixelOffset.y)/solidAngle,0.0);
}`;

export const NUCLEAR_COMPOSITE_FRAGMENT = /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uLight;
uniform vec2 uTargetSize;
uniform vec4 uTile;
uniform vec2 uFocal;
uniform mat3 uCameraRotation;
uniform vec3 uTransmission;
uniform vec3 uBackgroundRgb;
uniform float uIntensity;
uniform float uPresent;
${TRANSFER_GLSL}
${AIR_VIEW_GLSL}
void main() {
  if (uPresent < .5) { fragColor=vec4(0.0); return; }
  vec3 dir=normalize(uCameraRotation*vec3(((uTile.xy+vUv*uTile.zw)*2.0-1.0)/uFocal,-1.0));
  vec3 attenuation = uTransmission * airTransmittance(dir);
  // Interpolate linear radiance, and clamp to the live tile rather than
  // sampling stale pixels in the unused part of the fixed allocation.
  vec2 samplePixel=clamp(vUv*uTargetSize-.5,vec2(0.0),uTargetSize-1.0);
  ivec2 lo=ivec2(floor(samplePixel)),hi=min(lo+1,ivec2(uTargetSize)-1);vec2 f=fract(samplePixel);
  vec3 light=mix(mix(texelFetch(uLight,lo,0).rgb,texelFetch(uLight,ivec2(hi.x,lo.y),0).rgb,f.x),
    mix(texelFetch(uLight,ivec2(lo.x,hi.y),0).rgb,texelFetch(uLight,hi,0).rgb,f.x),f.y);
  vec3 total = light * attenuation * uContinuumShare;
  vec3 background = uBackgroundRgb * attenuation * uContinuumShare;
  vec3 excess = max(vec3(0.0),total-background);
  float power = dot(excess,vec3(.2126,.7152,.0722));
  float pedestal = dot(background,vec3(.2126,.7152,.0722))*uBeamPivot;
  float energy = min(uCeil,uGain*(pow(pedestal+power*uBeamPivot,uGamma)-pow(pedestal,uGamma)));
  vec3 shown = power>0.0 ? excess/power*energy : vec3(0.0);
  fragColor = vec4(scotopic(shown,power)*uIntensity*skyVisibility(dir),0.0);
}`;
