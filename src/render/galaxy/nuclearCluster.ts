import {
  AddEquation, BufferAttribute, BufferGeometry, Camera, Color, CustomBlending, DataTexture, FloatType,
  GLSL3, Group, InstancedBufferAttribute, InstancedBufferGeometry, Matrix3, Matrix4, Mesh, Object3D,
  NearestFilter, OneFactor, Quaternion, RedFormat, Scene, ShaderMaterial, Vector2, Vector3, Vector4,
  WebGLRenderer, WebGLRenderTarget, ZeroFactor,
} from 'three';
import type { ClusterStars } from '../../universe/galaxy/clusterStars';
import type { GalacticPosition } from '../../universe/galaxy/density';
import { requestNuclearClusterStars } from '../../workers/nuclearCluster';
import { seatExtendedInstrument, transferUniforms } from '../displayTransfer';
import { BEAM_SR, CAMERA_INSTRUMENT, EYE_INSTRUMENT, type DisplayInstrument } from '../../universe/galaxy/displayLaw';
import { rgbLuminance } from '../../core/color/optical';
import { SCATTER_OPACITY_RGB } from '../../universe/galaxy/dustScattering';
import { nuclearStarCluster } from '../../universe/galaxy/spheroid';
import { NUCLEAR_EPOCHS } from '../../universe/galaxy/nuclearPopulation';
import { nuclearColumnAt, nuclearProfileCdf, NUCLEAR_TRUNCATION } from '../../universe/galaxy/nuclearProfile';
import { airViewUniforms, applyAirView, type AirView } from '../lighting/airView';
import { nuclearTile, NUCLEAR_TARGET_LIMIT, type NuclearTile } from './nuclearProjection';
import { NUCLEAR_QUAD_VERTEX, NUCLEAR_TILE_VERTEX, NUCLEAR_SMOOTH_FRAGMENT, NUCLEAR_POINT_VERTEX,
  NUCLEAR_POINT_FRAGMENT, NUCLEAR_COMPOSITE_FRAGMENT } from './nuclearShaders';

function quadGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(new Float32Array([-1,-1,0, 1,-1,0, -1,1,0, 1,1,0]),3));
  geometry.setIndex([0,1,2,2,1,3]); return geometry;
}
function pointGeometry(): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(new Float32Array([-1,-1,0, 1,-1,0, -1,1,0, 1,1,0]),3));
  geometry.setIndex([0,1,2,2,1,3]);
  geometry.setAttribute('starPosition',new InstancedBufferAttribute(new Float32Array(0),3));
  geometry.setAttribute('starRgb',new InstancedBufferAttribute(new Float32Array(0),3));
  geometry.instanceCount=0; return geometry;
}
const additive = {blending:CustomBlending, blendEquation:AddEquation, blendSrc:OneFactor, blendDst:OneFactor,
  blendSrcAlpha:ZeroFactor, blendDstAlpha:OneFactor, transparent:false, depthWrite:false, depthTest:false, toneMapped:false} as const;

/** One optical-radiance sum for points and their faint parent population.
 * A single instrument response follows accumulation, so overlapping stars
 * cannot manufacture display light. The onBeforeRender prepass uses the
 * actual camera/viewport, including each black-hole cube face. */
export class NuclearCluster {
  readonly group = new Group();
  readonly radianceTarget = new WebGLRenderTarget(1,1,{type:FloatType, minFilter:NearestFilter, magFilter:NearestFilter, depthBuffer:false});
  lastTile: NuclearTile | null = null;
  ready = false;
  effectiveExposure = 1;
  aggregationShare = 0;
  private readonly composite: Mesh<BufferGeometry,ShaderMaterial>;
  private readonly sources = new Scene();
  private readonly points: Mesh<InstancedBufferGeometry,ShaderMaterial>;
  private readonly aggregate: Mesh<InstancedBufferGeometry,ShaderMaterial>;
  private readonly smooth: Mesh<BufferGeometry,ShaderMaterial>;
  private readonly tile = {value:new Vector4(0,0,1,1)};
  private readonly targetSize = {value:new Vector2(1,1)};
  private readonly focal = {value:new Vector2(1,1)};
  private readonly cancelBuild: () => void;
  private readonly halfMassPc = nuclearStarCluster().halfMassRadiusPc;
  private readonly scales = NUCLEAR_EPOCHS.map(e => e.scalePc ?? nuclearStarCluster().scaleRadiusPc);
  private readonly radiusPc = Math.max(...this.scales) * NUCLEAR_TRUNCATION;
  private data: Pick<ClusterStars,'epochs'|'column'> | null = null;
  private column: DataTexture | null = null;
  private disposed = false;
  private preparing = false;
  private preparationStarted = false;
  private instrument: DisplayInstrument = CAMERA_INSTRUMENT;
  private exposure = 1;
  private intensityValue = 1;
  private transmissionValue = 1;
  private readonly aggregatePositions = new Float32Array(12);
  private readonly aggregateRgb = new Float32Array(12);
  private readonly centroid = [new Vector3(),new Vector3()];
  private readonly centreView = new Vector3();
  private readonly viewFromCluster = new Matrix4();
  private readonly viewport = new Vector4();
  private readonly savedColor = new Color();

  constructor(viewpointPc: GalacticPosition, sceneFromGalaxy: Float32Array, private readonly pcKm: number,
    private readonly onReady: () => void = () => {}, request = requestNuclearClusterStars) {
    const shared = {uTile:this.tile, uTargetSize:this.targetSize, uFocal:this.focal};
    const pointMaterial = () => new ShaderMaterial({glslVersion:GLSL3, vertexShader:NUCLEAR_POINT_VERTEX,
      fragmentShader:NUCLEAR_POINT_FRAGMENT, uniforms:{...shared,uPcKm:{value:pcKm},uWeight:{value:1}},...additive});
    this.points = new Mesh(pointGeometry(),pointMaterial());
    this.aggregate = new Mesh(pointGeometry(),pointMaterial());
    this.aggregate.geometry.setAttribute('starPosition',new InstancedBufferAttribute(this.aggregatePositions,3));
    this.aggregate.geometry.setAttribute('starRgb',new InstancedBufferAttribute(this.aggregateRgb,3));
    this.aggregate.geometry.instanceCount=4;
    for(const points of [this.points,this.aggregate]) { points.frustumCulled=false; points.matrixAutoUpdate=false; this.sources.add(points); }
    this.smooth = new Mesh(quadGeometry(),new ShaderMaterial({glslVersion:GLSL3,vertexShader:NUCLEAR_TILE_VERTEX,
      fragmentShader:NUCLEAR_SMOOTH_FRAGMENT,uniforms:{...shared,uColumn:{value:null},uColumnSize:{value:new Vector2(1,1)},
        uObserverPc:{value:new Vector3()},uScales:{value:new Vector2(...this.scales)},uCuts:{value:new Vector2()},
        uUnresolved0:{value:new Vector3()},uUnresolved1:{value:new Vector3()},uCentrePixel:{value:new Vector2()},uRefineCentre:{value:0}},...additive}));
    this.smooth.frustumCulled=false; this.sources.add(this.smooth);
    this.composite = new Mesh(quadGeometry(),new ShaderMaterial({glslVersion:GLSL3,vertexShader:NUCLEAR_QUAD_VERTEX,
      fragmentShader:NUCLEAR_COMPOSITE_FRAGMENT,uniforms:{...shared,uLight:{value:this.radianceTarget.texture},
        uCameraRotation:{value:new Matrix3()},uTransmission:{value:[1,1,1]},uBackgroundRgb:{value:new Vector3()},
        uIntensity:{value:1},uPresent:{value:0},...transferUniforms(0),...airViewUniforms()},
      ...additive,depthTest:true}));
    this.composite.frustumCulled=false; this.composite.renderOrder=-7; this.composite.visible=false;
    this.composite.onBeforeRender=(renderer,_scene,camera)=>this.renderLight(renderer,camera);
    this.group.add(this.composite);
    const m=sceneFromGalaxy;
    const quat=new Quaternion().setFromRotationMatrix(new Matrix4().set(m[0],m[1],m[2],0,m[3],m[4],m[5],0,m[6],m[7],m[8],0,0,0,0,1));
    this.group.quaternion.copy(quat);
    this.group.position.set(-viewpointPc.xPc,-viewpointPc.yPc,-viewpointPc.zPc).applyQuaternion(quat);
    this.setInstrument(CAMERA_INSTRUMENT,1);
    this.cancelBuild=request(stars=>this.install(stars));
  }

  private install(stars: ClusterStars): void {
    if(this.disposed) return;
    this.data={epochs:stars.epochs,column:stars.column};
    const rgb=new Float32Array(stars.colors.length), weight=[0,0];
    for(let i=0;i<stars.opticalLuminosities.length;i++) {
      const e=stars.epochIndices[i], lum=stars.opticalLuminosities[i];
      for(let c=0;c<3;c++) rgb[i*3+c]=lum*stars.colors[i*3+c];
      this.centroid[e].x+=lum*stars.positionsPc[i*3]; this.centroid[e].y+=lum*stars.positionsPc[i*3+1]; this.centroid[e].z+=lum*stars.positionsPc[i*3+2]; weight[e]+=lum;
    }
    this.points.geometry.setAttribute('starPosition',new InstancedBufferAttribute(stars.positionsPc,3));
    this.points.geometry.setAttribute('starRgb',new InstancedBufferAttribute(rgb,3));
    this.points.geometry.instanceCount=stars.opticalLuminosities.length;
    for(let e=0;e<2;e++) {
      if(weight[e]>0) this.centroid[e].divideScalar(weight[e]);
      this.centroid[e].toArray(this.aggregatePositions,6+e*3);
      (this.smooth.material.uniforms[`uUnresolved${e}`].value as Vector3).fromArray(stars.epochs[e].unresolvedOpticalRgb);
    }
    this.column=new DataTexture(stars.column.data,stars.column.width,stars.column.height,RedFormat,FloatType);
    this.column.minFilter=this.column.magFilter=NearestFilter; this.column.needsUpdate=true;
    this.smooth.material.uniforms.uColumn.value=this.column;
    this.smooth.material.uniforms.uColumnSize.value.set(stars.column.width,stars.column.height);
    this.publish();
  }

  prepare(compile: (group: Object3D) => Promise<unknown>): void {
    if(this.disposed || this.preparationStarted) return;
    this.preparationStarted=this.preparing=true; this.ready=false; this.composite.visible=false;
    const complete=()=>{this.preparing=false;if(this.disposed)this.releaseResources();else this.publish();};
    // Both preparations own live materials until they settle, including
    // when one rejects or throws synchronously before the other finishes.
    void Promise.allSettled([this.sources,this.group].map(object =>
      Promise.resolve().then(() => compile(object)))).then(complete);
  }
  private publish(): void {
    if(this.disposed || this.ready || this.preparing || !this.data) return;
    this.ready=true;this.composite.visible=true;this.onReady();
  }
  /** Retain the viewer's overall core-exposure transition. Source
   * radiance is independent of this surrounding-sky display adjustment. */
  update(distancePc: number): number {
    const x=Math.min(1,Math.max(0,(distancePc-3*this.halfMassPc)/(17*this.halfMassPc)));return x*x*(3-2*x);
  }
  set intensity(value: number) { this.intensityValue=value; this.composite.material.uniforms.uIntensity.value=value; }
  setInstrument(instrument: DisplayInstrument, exposure: number): void {
    this.instrument=instrument;this.exposure=exposure;
    seatExtendedInstrument(this.composite.material.uniforms,0,instrument,exposure);
  }
  set transmission(value: number) {
    this.transmissionValue=Math.min(1,Math.max(0,value));
    this.composite.material.uniforms.uTransmission.value=SCATTER_OPACITY_RGB.map(k=>this.transmissionValue**k);
  }
  setAirView(air: AirView | null): void { applyAirView(this.composite.material,air); }

  private renderLight(renderer: WebGLRenderer,camera: Camera): void {
    const shown=this.composite.material.uniforms;
    shown.uPresent.value=0; this.lastTile=null;
    if(!this.data || this.intensityValue<=0 || this.transmissionValue<=0) return;
    renderer.getCurrentViewport(this.viewport);
    const width=this.viewport.z,height=this.viewport.w, p=camera.projectionMatrix.elements;
    this.viewFromCluster.multiplyMatrices(camera.matrixWorldInverse,this.group.matrixWorld);
    this.centreView.setFromMatrixPosition(this.viewFromCluster).divideScalar(this.pcKm);
    const tile=nuclearTile([this.centreView.x,this.centreView.y,this.centreView.z],this.radiusPc,width,height,p[0],p[5]);
    if(!tile) return;
    this.lastTile=tile;this.tile.value.set(tile.x/width,tile.y/height,tile.width/width,tile.height/height);
    this.targetSize.value.set(tile.targetWidth,tile.targetHeight);this.focal.value.set(p[0],p[5]);
    shown.uCameraRotation.value.setFromMatrix4(camera.matrixWorld);
    this.points.matrix.copy(this.group.matrixWorld);this.aggregate.matrix.copy(this.group.matrixWorld);
    const distance=this.centreView.length();
    const pixelAngle=Math.max(2*tile.width/(width*p[0]*tile.targetWidth),2*tile.height/(height*p[5]*tile.targetHeight));
    const radiusPixels=this.radiusPc/Math.max(distance,1e-12)/pixelAngle;
    const fade=Math.min(1,Math.max(0,(1-radiusPixels)/.5));const aggregateShare=fade*fade*(3-2*fade);
    this.aggregationShare=aggregateShare;
    this.points.material.uniforms.uWeight.value=1-aggregateShare;this.points.visible=aggregateShare<1;
    const cuts=this.smooth.material.uniforms.uCuts.value as Vector2;
    const background=shown.uBackgroundRgb.value as Vector3;background.set(0,0,0);
    this.smooth.material.uniforms.uObserverPc.value.copy(this.centreView).negate();
    const projectedDepth=Math.max(1e-12,-this.centreView.z);
    this.smooth.material.uniforms.uCentrePixel.value.set(
      ((1+this.centreView.x*p[0]/projectedDepth)*.5-this.tile.value.x)/this.tile.value.z*tile.targetWidth,
      ((1+this.centreView.y*p[5]/projectedDepth)*.5-this.tile.value.y)/this.tile.value.w*tile.targetHeight);
    this.smooth.material.uniforms.uRefineCentre.value=distance>this.radiusPc?1:0;
    let characteristicRadiance=0;
    for(let e=0;e<2;e++) {
      const scale=this.scales[e], epoch=this.data.epochs[e];
      characteristicRadiance+=rgbLuminance(epoch.totalOpticalRgb)/(4*Math.PI*Math.PI*(scale*scale+(distance*pixelAngle)**2));
      // A sphere smaller than half a sample is represented as integrated
      // flux, never a point sample of its divergent projected centre.
      const cut=distance>NUCLEAR_TRUNCATION*scale ? Math.min(NUCLEAR_TRUNCATION,.5*distance*pixelAngle/scale) : 0;
      cuts.setComponent(e,cut);
      const fraction=nuclearProfileCdf(cut);
      for(let c=0;c<3;c++) {
        this.aggregateRgb[e*3+c]=epoch.unresolvedOpticalRgb[c]*fraction;
        this.aggregateRgb[6+e*3+c]=epoch.resolvedOpticalRgb[c]*aggregateShare;
      }
      // Deep exposures subtract the actual minimum isotropic cluster
      // background. Eye mode keeps it. No arbitrary brightness multiplier.
      if(this.instrument!==EYE_INSTRUMENT && distance<NUCLEAR_TRUNCATION*scale) {
        const column=nuclearColumnAt(this.data.column,0,NUCLEAR_TRUNCATION)-nuclearColumnAt(this.data.column,0,distance/scale);
        background.addScaledVector(this.smooth.material.uniforms[`uUnresolved${e}`].value,column/(4*Math.PI*scale*scale));
      }
    }
    // One automatic camera exposure for ALL cluster light, derived from
    // its characteristic surface brightness and angular blur. It targets
    // photographic middle gray without modifying the radiance buffer.
    // Narrowband keeps this broadband exposure, so rejected continuum
    // is not brightened back up. Eye retains the fixed observer response.
    const cameraPivot=CAMERA_INSTRUMENT.pivotLsunPc2*(.18/CAMERA_INSTRUMENT.gain)**(1/CAMERA_INSTRUMENT.gamma);
    this.effectiveExposure=this.exposure*(this.instrument===EYE_INSTRUMENT?1:Math.min(1,cameraPivot/Math.max(1e-30,4*Math.PI*BEAM_SR*characteristicRadiance)));
    seatExtendedInstrument(shown,0,this.instrument,this.effectiveExposure);
    this.aggregate.geometry.getAttribute('starPosition').needsUpdate=true;
    this.aggregate.geometry.getAttribute('starRgb').needsUpdate=true;
    this.smooth.visible=cuts.x<NUCLEAR_TRUNCATION || cuts.y<NUCLEAR_TRUNCATION;
    if(this.radianceTarget.width!==NUCLEAR_TARGET_LIMIT) {
      // Full float is required for additive sums of thousands of sources;
      // half-float blending loses small contributions to a bright pixel.
      renderer.extensions.get('EXT_float_blend');
      this.radianceTarget.setSize(NUCLEAR_TARGET_LIMIT,NUCLEAR_TARGET_LIMIT);
    }
    const previous=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),level=renderer.getActiveMipmapLevel();
    const auto=renderer.autoClear,alpha=renderer.getClearAlpha();
    renderer.getClearColor(this.savedColor);
    try {
      // Target viewports are physical pixels. Renderer.setViewport and
      // setScissor multiply by device pixel ratio even on a target, and
      // also overwrite the default framebuffer's logical viewport.
      this.radianceTarget.viewport.set(0,0,tile.targetWidth,tile.targetHeight);
      this.radianceTarget.scissor.copy(this.radianceTarget.viewport);
      this.radianceTarget.scissorTest=true;
      renderer.setRenderTarget(this.radianceTarget);
      renderer.setClearColor(0,0);renderer.clear(true,false,false);renderer.autoClear=false;
      renderer.render(this.sources,camera);
    } finally {
      renderer.autoClear=auto;renderer.setRenderTarget(previous,face,level);
      renderer.setClearColor(this.savedColor,alpha);
    }
    shown.uPresent.value=1;
  }

  dispose(): void {
    if(this.disposed)return;this.disposed=true;this.cancelBuild();this.ready=false;this.composite.visible=false;
    if(!this.preparing)this.releaseResources();
  }
  private releaseResources(): void {
    this.column?.dispose();this.radianceTarget.dispose();this.data=null;
    for(const mesh of [this.points,this.aggregate,this.smooth,this.composite]) {mesh.geometry.dispose();mesh.material.dispose();}
  }
}
