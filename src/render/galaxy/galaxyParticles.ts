import {
  AddEquation, BufferAttribute, BufferGeometry, Camera, Color, CustomBlending, FloatType, GLSL3,
  Matrix3, NearestFilter, OneFactor, Points, Scene, ShaderMaterial, Vector2, Vector3, Vector4,
  WebGLRenderer, WebGLRenderTarget, ZeroFactor,
} from 'three';
import type { GalaxyParticleSet } from '../../universe/galaxy/particles';
import { buildGalaxyRadianceGlsl } from '../glsl/galaxyRadiance';
import type { GalaxyLuts } from './galaxyLuts';

export const GALAXY_STAR_TARGET_LIMIT = 1024;
const VERTEX = /* glsl */ `
in vec3 aOpticalRgb;
uniform vec3 uCamGalKpc;
uniform mat3 uGalaxyToView;
uniform vec2 uTargetSize;
uniform sampler2D uExtinction;
flat out vec2 vPixelCentre;
flat out vec3 vFlux;
void main() {
  vec3 view = uGalaxyToView * (position - uCamGalKpc * 1000.0);
  vec4 clip = projectionMatrix * vec4(view,1.0);
  gl_PointSize = 6.0;
  vFlux=vec3(0.0); vPixelCentre=vec2(0.0);
  if (clip.w <= 0.0 || any(greaterThan(abs(clip.xy),clip.ww*(1.0+6.0/uTargetSize)))) {
    gl_Position=vec4(2.0,2.0,0.0,1.0);return;
  }
  vPixelCentre=(clip.xy/clip.w*.5+.5)*uTargetSize;
  vFlux=aOpticalRgb * texelFetch(uExtinction,ivec2(gl_VertexID % 512,gl_VertexID / 512),0).rgb /
    (12.566370614359172*max(dot(view,view),1e-24));
  gl_Position=vec4(clip.xy,0.0,clip.w);
}`;
const FRAGMENT = /* glsl */ `
flat in vec2 vPixelCentre;
flat in vec3 vFlux;
uniform vec2 uTargetSize;
uniform vec2 uFocal;
out vec4 fragColor;
float kernel(float x) {
  float a=abs(x);
  return a<1.0 ? 2.0/3.0-a*a+.5*a*a*a : (a<2.0 ? pow(2.0-a,3.0)/6.0 : 0.0);
}
void main() {
  vec2 offset=gl_FragCoord.xy-vPixelCentre;
  if(any(greaterThanEqual(abs(offset),vec2(2.0))))discard;
  vec2 plane=(gl_FragCoord.xy/uTargetSize*2.0-1.0)/uFocal;
  float omega=4.0/(uTargetSize.x*uTargetSize.y*uFocal.x*uFocal.y*pow(1.0+dot(plane,plane),1.5));
  fragColor=vec4(vFlux*kernel(offset.x)*kernel(offset.y)/omega,0.0);
}`;

const EXTINCTION_VERTEX = /* glsl */ `
uniform vec2 uAtlasSize;
flat out vec3 vSource;
void main() {
  vec2 pixel=vec2(gl_VertexID % 512,gl_VertexID / 512)+.5;
  gl_Position=vec4(pixel/uAtlasSize*2.0-1.0,0.0,1.0);gl_PointSize=1.0;
  vSource=position/1000.0;
}`;
const EXTINCTION_FRAGMENT = /* glsl */ `
flat in vec3 vSource;
uniform vec3 uCamGalKpc;
out vec4 fragColor;
${buildGalaxyRadianceGlsl(true, true)}
void main() {
  fragColor=vec4(uDustScale<=0.0?vec3(1.0):galaxyTransmission(uCamGalKpc,vSource),1.0);
}`;

/** Linear stellar light, consumed by GalaxyVolume before its instrument
 * curve. A six-pixel raster envelope contains the four-pixel normalized
 * kernel even when hardware rounds a point's raster centre. Source
 * extinction has its own small fragment pass: tracing thousands of
 * columns in the vertex stage is much slower on the tested GPU.
 * Columns depend on observer position, while the light image also
 * depends on view orientation/projection. Cache those separately. */
export class GalaxyParticles {
  readonly scene = new Scene();
  readonly extinctionScene = new Scene();
  private readonly extinctionTarget = new WebGLRenderTarget(1,1,{type:FloatType,minFilter:NearestFilter,magFilter:NearestFilter,depthBuffer:false});
  private readonly extinctionPoints: Points<BufferGeometry,ShaderMaterial>;
  private readonly lastObserver = new Vector3(Infinity,Infinity,Infinity);
  private lastDust = NaN;
  private readonly lastProjection = new Float64Array(16).fill(NaN);
  private readonly lastRotation = new Matrix3().multiplyScalar(0);
  private readonly lastSize = new Vector2();
  private lightValid = false;
  readonly target = new WebGLRenderTarget(1,1,{type:FloatType,minFilter:NearestFilter,magFilter:NearestFilter,depthBuffer:false});
  readonly size = new Vector2(1,1);
  readonly selectedMean = new Vector3();
  count = 0;
  ready = false;
  private readonly points: Points<BufferGeometry,ShaderMaterial>;
  private readonly viewport = new Vector4();
  private readonly cameraRotation = new Matrix3();
  private readonly savedColor = new Color();
  private disposed = false;

  constructor(luts: GalaxyLuts, uniforms: Record<string,{value:unknown}>, onReady:()=>void) {
    const geometry=new BufferGeometry();
    geometry.setAttribute('position',new BufferAttribute(new Float32Array(0),3));
    geometry.setAttribute('aOpticalRgb',new BufferAttribute(new Float32Array(0),3));
    this.points=new Points(geometry,new ShaderMaterial({glslVersion:GLSL3,vertexShader:VERTEX,fragmentShader:FRAGMENT,
      uniforms:{...uniforms,uExtinction:{value:this.extinctionTarget.texture},uGalaxyToView:{value:new Matrix3()},uTargetSize:{value:this.size},uFocal:{value:new Vector2()}},
      blending:CustomBlending,blendEquation:AddEquation,blendSrc:OneFactor,blendDst:OneFactor,
      blendSrcAlpha:ZeroFactor,blendDstAlpha:OneFactor,transparent:false,depthWrite:false,depthTest:false,toneMapped:false}));
    this.points.frustumCulled=false;this.scene.add(this.points);
    this.extinctionPoints=new Points(geometry,new ShaderMaterial({glslVersion:GLSL3,
      vertexShader:EXTINCTION_VERTEX,fragmentShader:EXTINCTION_FRAGMENT,
      uniforms:{...uniforms,uAtlasSize:{value:new Vector2()}},depthWrite:false,depthTest:false,toneMapped:false}));
    this.extinctionPoints.frustumCulled=false;this.extinctionScene.add(this.extinctionPoints);
    void luts.ready.then(()=>{
      if(this.disposed || !luts.particles)return;
      this.install(luts.particles);onReady();
    });
  }
  private install(set:GalaxyParticleSet): void {
    this.points.geometry.setAttribute('position',new BufferAttribute(set.positionsPc,3));
    this.points.geometry.setAttribute('aOpticalRgb',new BufferAttribute(set.opticalRgb,3));
    this.extinctionTarget.setSize(512,Math.ceil(set.count/512));
    this.extinctionPoints.material.uniforms.uAtlasSize.value.set(512,Math.ceil(set.count/512));
    this.count=set.count;this.selectedMean.fromArray(set.selectedMeanRgb);this.ready=true;
  }
  render(renderer:WebGLRenderer,camera:Camera,worldToGalaxy:Matrix3): void {
    if(!this.ready || this.disposed)return;
    renderer.getCurrentViewport(this.viewport);
    const scale=Math.min(1,GALAXY_STAR_TARGET_LIMIT/Math.max(this.viewport.z,this.viewport.w));
    this.size.set(Math.max(1,Math.ceil(this.viewport.z*scale)),Math.max(1,Math.ceil(this.viewport.w*scale)));
    this.points.material.uniforms.uGalaxyToView.value.copy(worldToGalaxy)
      .multiply(this.cameraRotation.setFromMatrix4(camera.matrixWorld)).transpose();
    const p=camera.projectionMatrix.elements;
    this.points.material.uniforms.uFocal.value.set(p[0],p[5]);
    const observer=this.extinctionPoints.material.uniforms.uCamGalKpc.value as Vector3;
    const dust=this.extinctionPoints.material.uniforms.uDustScale.value as number;
    const refreshDust=!observer.equals(this.lastObserver) || dust!==this.lastDust;
    const rotation=this.points.material.uniforms.uGalaxyToView.value as Matrix3;
    if(this.lightValid && !refreshDust && this.size.equals(this.lastSize) && rotation.equals(this.lastRotation) && p.every((v,i)=>v===this.lastProjection[i]))return;
    this.lightValid=false;
    if(this.target.width!==GALAXY_STAR_TARGET_LIMIT) {
      renderer.extensions.get('EXT_float_blend');this.target.setSize(GALAXY_STAR_TARGET_LIMIT,GALAXY_STAR_TARGET_LIMIT);
    }
    const previous=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),level=renderer.getActiveMipmapLevel();
    const auto=renderer.autoClear,alpha=renderer.getClearAlpha();renderer.getClearColor(this.savedColor);
    try {
      renderer.autoClear=false;
      if(refreshDust) {
        renderer.setRenderTarget(this.extinctionTarget);renderer.setClearColor(0,0);renderer.clear(true,false,false);
        renderer.render(this.extinctionScene,camera);
        this.lastObserver.copy(observer);this.lastDust=dust;
      }
      this.target.viewport.set(0,0,this.size.x,this.size.y);this.target.scissor.copy(this.target.viewport);this.target.scissorTest=true;
      renderer.setRenderTarget(this.target);renderer.setClearColor(0,0);renderer.clear(true,false,false);renderer.autoClear=false;
      renderer.render(this.scene,camera);
      this.lastSize.copy(this.size);this.lastRotation.copy(rotation);this.lastProjection.set(p);this.lightValid=true;
    } finally {
      renderer.autoClear=auto;renderer.setRenderTarget(previous,face,level);renderer.setClearColor(this.savedColor,alpha);
    }
  }
  dispose(): void {
    if(this.disposed)return;
    this.disposed=true;this.ready=false;this.target.dispose();this.extinctionTarget.dispose();this.extinctionPoints.material.dispose();this.points.geometry.dispose();this.points.material.dispose();
  }
}
