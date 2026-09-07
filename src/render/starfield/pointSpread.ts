import { Vector4, type ShaderMaterial } from 'three';

/** One fixed angular PSF: a cubic B-spline one reference pixel wide.
 * Integrate its CDF over each detector pixel, rather than sampling a
 * disc mask. The weights partition unity at every subpixel phase. */
export function pointSpreadCdf(x: number): number {
  const a = Math.abs(x);
  const positive = a >= 2 ? 1 : a >= 1 ? 1 - (2-a)**4/24
    : .5 + 2*a/3 - a**3/3 + a**4/8;
  return x < 0 ? 1-positive : positive;
}
export function pointSpreadWeight(offset: number, scale: number): number {
  return pointSpreadCdf((offset+.5)/scale)-pointSpreadCdf((offset-.5)/scale);
}
export const POINT_SPREAD_GLSL = /* glsl */ `
float pointCdf(float x) {
  float a=abs(x);
  float positive=a>=2.0?1.0:(a>=1.0?1.0-pow(2.0-a,4.0)/24.0:
    .5+2.0*a/3.0-a*a*a/3.0+a*a*a*a/8.0);
  return x<0.0?1.0-positive:positive;
}
float pointWeight(float offset,float scale) {
  return max(0.0,pointCdf((offset+.5)/scale)-pointCdf((offset-.5)/scale));
}
`;
export function pointRasterVertex(varying = 'varying'): string {
  return `uniform vec4 uPointViewport;
uniform float uPointScale;
${varying} vec2 vPointCentre;
${varying} float vPointWidth;
void seatPointRaster(vec4 clip) {
  vPointCentre=uPointViewport.xy+(clip.xy/clip.w*.5+.5)*uPointViewport.zw;
  vPointWidth=max(.25,uPointScale);
  gl_PointSize=ceil(4.0*vPointWidth+2.0);
}`;
}
export function pointRasterFragment(varying = 'varying'): string {
  return `${varying} vec2 vPointCentre;
${varying} float vPointWidth;
${POINT_SPREAD_GLSL}
float pointPixelWeight() {
  vec2 offset=gl_FragCoord.xy-vPointCentre;
  return pointWeight(offset.x,vPointWidth)*pointWeight(offset.y,vPointWidth);
}`;
}

/** Read the actual target viewport and projection on every draw. This
 * includes high-DPI screens and cube captures, with no mutable capture
 * scale to restore. Display energy is an integral per reference beam;
 * scale² keeps the same angular image brightness at another resolution. */
export function installPointRaster(material: ShaderMaterial): void {
  const viewport = new Vector4();
  material.uniforms.uPointViewport = { value: viewport };
  material.uniforms.uPointScale = { value: 1 };
  const reference = 1080 / Math.tan(55*Math.PI/360);
  material.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getCurrentViewport(viewport);
    material.uniforms.uPointScale.value = viewport.w * Math.abs(camera.projectionMatrix.elements[5]) / reference;
    material.uniformsNeedUpdate = true;
  };
}
