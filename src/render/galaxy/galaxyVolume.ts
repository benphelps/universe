import { setStarGlobalDust, setStarDustFrame } from '../starfield/globalDustState';
import { galaxyComponentUniforms } from '../glsl/galaxyComponents';
import {
  AddEquation,
  BackSide,
  CustomBlending,
  GLSL3,
  Matrix3,
  Vector2,
  Vector4,
  type Object3D,
  type Camera,
  type WebGLRenderer,
  Mesh,
  OneFactor,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  ZeroFactor,
} from 'three';
import type { GalacticPosition } from '../../universe/galaxy/density';
import { buildGalaxyRadianceGlsl } from '../glsl/galaxyRadiance';
import { galaxyLutTextures } from './galaxyLuts';
import { GalaxyParticles } from './galaxyParticles';
import { seatExtendedInstrument, transferUniforms, TRANSFER_GLSL } from '../displayTransfer';
import { CAMERA_INSTRUMENT, EYE_INSTRUMENT, type DisplayInstrument } from '../../universe/galaxy/displayLaw';

const VERTEX = /* glsl */ `
// The dome is a unit sphere centered on the camera and never rotated,
// so the local vertex position IS the view ray — no planet-scale
// world coordinates ever enter the varying.
out vec3 vRay;
void main() {
  vRay = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Directional background only: the ray-marched galaxy is infinitely
  // behind local geometry, even though its carrier dome follows the camera.
  gl_Position.z = 1e-24 * gl_Position.w;
}
`;

// The shader itself no longer belongs to a galaxy — the wave lives in
// the arm LUT the material binds — so the source can stand at module
// scope without committing the session to a seed.
export const GALAXY_VOLUME_FRAGMENT = /* glsl */ `
in vec3 vRay;
out vec4 fragColor;
uniform vec3 uCamGalKpc;
uniform mat3 uWorldToGalaxy;
uniform float uOpacity;
uniform sampler2D uStars;
uniform vec2 uStarSize;
uniform vec4 uViewport;
uniform float uStarsActive;
uniform float uPedestalRadiance;
${buildGalaxyRadianceGlsl(true)}
${TRANSFER_GLSL}
vec3 starRadiance() {
  if (uStarsActive < .5) return vec3(0.0);
  vec2 pixel=clamp((gl_FragCoord.xy-uViewport.xy)/uViewport.zw*uStarSize-.5,vec2(0.0),uStarSize-1.0);
  ivec2 lo=ivec2(floor(pixel)),hi=min(lo+1,ivec2(uStarSize)-1);vec2 f=fract(pixel);
  return mix(mix(texelFetch(uStars,lo,0).rgb,texelFetch(uStars,ivec2(hi.x,lo.y),0).rgb,f.x),
    mix(texelFetch(uStars,ivec2(lo.x,hi.y),0).rgb,texelFetch(uStars,hi,0).rgb,f.x),f.y);
}
void main() {
  vec3 dir=normalize(uWorldToGalaxy*vRay);
  vec3 column=galaxyRadiance(uCamGalKpc,dir)+starRadiance();
#ifdef GALAXY_PHYSICAL_OUTPUT
  fragColor=vec4(column,0.0);
#else
  float power=dot(column,vec3(.2126,.7152,.0722));
  vec3 hue=column/max(power,1e-30);
  float radiance=max(0.0,power-uPedestalRadiance)*uContinuumShare;
  fragColor=vec4(scotopic(hue*displayRadiance(radiance),radiance)*uOpacity,0.0);
#endif
}
`;

/**
 * The galaxy as a volume: the shared line-of-sight integral marched
 * per pixel from wherever the camera actually is. From inside it
 * reproduces the band; from outside the spiral, bulge, and dust
 * patchiness emerge from the same model the sky field and the black
 * hole's bent rays read.
 */
export class GalaxyVolume {
  readonly mesh: Mesh;
  /** Where the camera stands in the galaxy, kpc — computed for the
   *  march and reused by anything else that needs a sightline. */
  readonly cameraGalacticKpc = new Vector3();
  private readonly material: ShaderMaterial;
  private readonly stars: GalaxyParticles;
  private readonly onReady: () => void;
  private instrument: DisplayInstrument = CAMERA_INSTRUMENT;
  private exposure = 1;
  private pedestal = 0;
  private sourcesLoaded = false;
  get ready(): boolean { return this.sourcesLoaded && !this.preparing && !this.disposed; }
  private preparing = false;
  private prepared = false;
  private disposed = false;
  starsEnabled = true;
  get starCount(): number { return this.mesh.visible && this.starsEnabled && this.stars.ready ? this.stars.count : 0; }
  get starTarget() { return this.stars.target; }
  get starTargetSize() { return this.stars.size; }
  /** Row-major scene→galactic rotation (transpose of sceneFromGalaxy). */
  private readonly sceneToGalaxy: Matrix3;
  private readonly pointCameraToGalaxy = new Matrix3();
  private readonly pointObserverWorldKm = new Vector3();
  private pointPcKm = 1;

  constructor(
    private readonly viewpointPc: GalacticPosition,
    sceneFromGalaxy: Float32Array,
    onReady: () => void = () => {},
  ) {
    this.onReady = onReady;
    const m = sceneFromGalaxy;
    // sceneFromGalaxy is row-major galactic→scene; its transpose goes back.
    this.sceneToGalaxy = new Matrix3().set(
      m[0], m[3], m[6],
      m[1], m[4], m[7],
      m[2], m[5], m[8],
    );
    const luts = galaxyLutTextures();
    void luts.ready.then(() => { this.sourcesLoaded = true; });
    const components = galaxyComponentUniforms();
    this.material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERTEX,
      fragmentShader: GALAXY_VOLUME_FRAGMENT,
      uniforms: {
        uCamGalKpc: { value: new Vector3() },
        uWorldToGalaxy: { value: new Matrix3() },
        uBulgeModel: { value: components.bulge },
        uBulgeCore: { value: components.core },
        uPopulationR: { value: components.optical[0] },
        uPopulationG: { value: components.optical[1] },
        uPopulationB: { value: components.optical[2] },
        uOpacity: { value: 0 },
        uSelectedThin: { value: new Vector3() },
        uDustScale: { value: 1 },
        uStars: { value: null },
        uStarSize: { value: new Vector2(1,1) },
        uStarsActive: { value: 0 },
        uViewport: { value: new Vector4() },
        uPedestalRadiance: { value: 0 },
        ...transferUniforms(0),
        uArmLut: { value: luts.armLut },
        uClumpNoise: { value: luts.clumpTile },
      },
      side: BackSide,
      // Pure added light, and only light: colour accumulates, alpha is
      // left exactly as it stands. AdditiveBlending would scale the
      // colour by src alpha, and the sky target needs this dome to
      // leave alpha to the nebula that composites after it.
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
      // Keep background light in the early queue and let real scene depth
      // occlude it. A transparent, depth-disabled dome renders after opaque
      // planets and visibly lays the galactic band over their discs.
      transparent: false,
      depthWrite: false,
      depthTest: true,
    });
    this.stars = new GalaxyParticles(luts, this.material.uniforms, () => { if (!this.disposed) this.onReady(); });
    this.material.uniforms.uStars.value = this.stars.target.texture;
    this.material.uniforms.uStarSize.value = this.stars.size;
    this.mesh = new Mesh(new SphereGeometry(1, 24, 12), this.material);
    this.mesh.renderOrder = -8;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.onBeforeRender = (renderer, _scene, camera) => this.renderStars(renderer,camera);
  }

  /** Keep point foreground columns on the camera's actual position and
   * rotation even while the exterior dome is hidden. Reuse its arm LUT. */
  updatePointExtinction(cameraRotation: Matrix3): void {
    this.pointCameraToGalaxy.multiplyMatrices(this.material.uniforms.uWorldToGalaxy.value,cameraRotation);
    setStarGlobalDust(this.material.uniforms.uArmLut.value,this.cameraGalacticKpc,this.pointCameraToGalaxy);
    setStarDustFrame(this.material.uniforms.uWorldToGalaxy.value,this.pointObserverWorldKm,this.pointPcKm);
  }

  /**
   * Per-frame state: camera world position (km), where the viewpoint
   * the galaxy is placed about stands in the same frame (the focus can
   * carry the scene's origin away from it), the world→scene rotation
   * (inverse of the ground frame), fade opacity, and a dome radius
   * safely inside the far plane.
   */
  update(
    cameraWorldKm: Vector3,
    viewpointWorldKm: Vector3,
    worldToScene: Matrix3,
    pcKm: number,
    opacity: number,
    domeRadiusKm: number,
  ): void {
    this.pointObserverWorldKm.copy(cameraWorldKm);this.pointPcKm=pcKm;
    // Where the camera stands in the galaxy is not a drawing concern:
    // sightlines through the dust are wanted whether the dome is on or
    // not, so this is settled before anything asks about visibility.
    const worldToGalaxy = this.material.uniforms.uWorldToGalaxy.value as Matrix3;
    worldToGalaxy.multiplyMatrices(this.sceneToGalaxy, worldToScene);

    const camGal = this.material.uniforms.uCamGalKpc.value as Vector3;
    camGal
      .copy(cameraWorldKm)
      .sub(viewpointWorldKm)
      .applyMatrix3(worldToGalaxy)
      .divideScalar(pcKm);
    camGal.set(
      (camGal.x + this.viewpointPc.xPc) / 1000,
      (camGal.y + this.viewpointPc.yPc) / 1000,
      (camGal.z + this.viewpointPc.zPc) / 1000,
    );
    this.cameraGalacticKpc.copy(camGal);

    this.mesh.visible = opacity > 0.002 && !this.preparing && !this.disposed;
    if (!this.mesh.visible) return;
    this.material.uniforms.uOpacity.value = opacity;
    const pedestal = this.instrument === EYE_INSTRUMENT ? 0 : this.pedestal * (1-opacity);
    this.material.uniforms.uPedestalRadiance.value = pedestal;
    seatExtendedInstrument(this.material.uniforms,pedestal,this.instrument,this.exposure);
    this.mesh.position.copy(cameraWorldKm);
    this.mesh.scale.setScalar(domeRadiusKm);
  }

  setInstrument(instrument: DisplayInstrument, exposure: number, pedestal = 0): void {
    this.instrument=instrument;this.exposure=exposure;this.pedestal=pedestal;
  }

  prepare(compile: (object:Object3D) => Promise<unknown>): void {
    if(this.prepared || this.disposed)return;
    this.prepared=this.preparing=true;this.mesh.visible=false;
    void Promise.allSettled([this.mesh,this.stars.scene,this.stars.extinctionScene].map(object => Promise.resolve().then(()=>compile(object)))).then(()=>{
      this.preparing=false;
      if(this.disposed)this.release();else this.onReady();
    });
  }

  private renderStars(renderer:WebGLRenderer,camera:Camera): void {
    const u=this.material.uniforms;
    u.uStarsActive.value=0;u.uSelectedThin.value.set(0,0,0);
    renderer.getCurrentViewport(u.uViewport.value);
    if(!this.starsEnabled || !this.stars.ready)return;
    this.stars.render(renderer,camera,u.uWorldToGalaxy.value);
    u.uSelectedThin.value.copy(this.stars.selectedMean);u.uStarsActive.value=1;
  }

  dispose(): void {
    if(this.disposed)return;this.disposed=true;this.mesh.visible=false;
    if(!this.preparing)this.release();
  }
  private release(): void {
    this.stars.dispose();this.mesh.geometry.dispose();this.material.dispose();
  }
}
