import {
  Color,
  type Object3D,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Mesh,
  NoColorSpace,
  NormalBlending,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type CubeTexture,
  type PerspectiveCamera,
  type WebGLCubeRenderTarget,
  type WebGLRenderer,
} from 'three';
import { discPeakRadiusRg, horizonRadiusRg, iscoRadiusRg } from '../../core/physics/blackHole';
import { orbitEnergyAngular } from '../../core/physics/kerr';
import { flowTemperature } from '../../universe/galaxy/accretionFlow';
import type { AccretionFlow } from '../../universe/galaxy/accretionFlow';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { drawnFlowRadiusRg, GEODESIC_GLSL } from './geodesicGlsl';
import { KERR_GLSL } from './kerrGlsl';
import { REGULAR_KERR_GLSL } from './regularKerrGlsl';
import { acquireFlowNoise, updateFlowEddies } from './flowNoise';
import { createCaptureTable } from './captureTable';
import { createFlowSpectrum, thermalVisibleSample } from './flowSpectrum';
import { createHotFlowSpectrum } from './hotFlowSpectrum';
import type { BlackHoleTables } from './blackHoleTables';
import { HotFlowField } from './hotFlowField';
import { createHotOutflowSpectrum } from './hotOutflowSpectrum';
import { HotFlowAtlas } from './hotFlowAtlas';

/** Peak-relative exposure for readable flows. Visible radiance stays
 * linear until the shared HDR output transform. */
const DISC_EXPOSURE = 2.0;
/** Past this separation the shadow is a millionth of a pixel and the
 *  ray's start point stops fitting in a float: the nuclear cluster is
 *  all there is to see of the centre from out here, and it is enough. */
const RENDER_REACH_RG = 3e5;
/** Below this Eddington ratio a flow is not drawn at all. */
const FLOW_VISIBILITY_FLOOR = 1e-10;
/**
 * The most of a turn the flow is allowed to advance between two drawn
 * frames.
 *
 * Not a speed limit on the hole — the shadow, the beaming and the
 * shape of the flow do not depend on this clock at all, only the
 * clumping's motion does. It is a limit on what a sequence of frames
 * can carry. The turbulence is sampled on a ring some twenty-five
 * noise cells around, so a pattern moving more than half a cell
 * between frames is aliased, and past that showing it turn faster does
 * not show it turning faster: it shows a wagon wheel, and then, once
 * the count of turns is large enough to swallow the azimuth in a
 * float, nothing at all.
 *
 * The time control reaches ten years a second. At the galactic centre
 * that is eight million orbits of the inner edge every second, and at
 * a stellar hole it is far more; either one runs out of float inside a
 * second or two of watching, and what a viewer sees is the clumping
 * dissolving into an even glow and staying there. Held to a fiftieth
 * of a turn a frame, the inner edge turns about once a second however
 * hard time is driven, and the flow keeps its texture for as long as
 * anyone watches it.
 */
const FLOW_TURNS_PER_FRAME = 0.02;

const VERTEX = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  // Screen-filling and pinned just inside the reversed-Z far plane, so
  // anything real in the scene still occludes the hole.
  gl_Position = vec4(position.xy, 1e-24, 1.0);
}
`;

/** What the scene draws: the traced image, and nothing else. */
const COMPOSITE_FRAGMENT = /* glsl */ `
varying vec2 vNdc;
uniform sampler2D uTrace;
void main() {
  gl_FragColor = texture2D(uTrace, vNdc * 0.5 + 0.5);
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vNdc;
uniform mat3 uBhToScene;
uniform samplerCube uSkyCube;
uniform float uSkyOpacity;
uniform float uOpacity;
uniform vec2 uOutputSize;

${SIMPLEX_NOISE_GLSL}
${KERR_GLSL}
${GEODESIC_GLSL}
${REGULAR_KERR_GLSL}

vec3 incidentRay(vec2 ndc) {
  return normalize(uViewToBh * vec3(ndc * uTanHalfFov, -1.0));
}
vec3 sampleRay(vec3 dir, out float escapeMask) {
  vec3 escapeDir;bool escaped;vec3 transmittance;
  #ifdef REFERENCE_TRACE
  vec3 light=traceGeodesic(dir,escapeDir,escaped,transmittance);
#else
  vec3 light=traceRegularKerr(dir,escapeDir,escaped,transmittance);
#endif
  escapeMask=escaped?1.0:0.0;
  // Read the background for all lanes so texture derivatives are defined
  // across the shadow boundary as well as through the open sky.
  vec3 sky=textureCube(uSkyCube,normalize(uBhToScene*escapeDir)).rgb;
  return light+transmittance*escapeMask*sky*uSkyOpacity;
}

// Outside the strong-lensing image, intersect the thin disk directly.
// This weak-field approximation uses the same gas and local frequency
// shift, and blends into the Kerr image over its existing 88–160 r_g
// handoff. It adds one surface sample, with no sky recapture or ray march.
vec4 outerDisc(vec3 dir) {
  if (uAspect > THICK_FLOW || uOuterRg <= 0.0 || abs(dir.z) < 1e-7) return vec4(0.0);
  float distance = -uCamRg.z / dir.z;
  if (distance <= 0.0) return vec4(0.0);
  vec3 hit = uCamRg + distance * dir;
  float r = sqrt(max(dot(hit.xy, hit.xy) - uSpin*uSpin, 0.0));
  if (r < LENSING_SOLID || r >= uOuterRg) return vec4(0.0);
  float phi = atan(hit.y, hit.x);
  float density = flowDensity(r, phi, 0.0);
  float tEmit = flowTemperature(r) * pow(density, 0.25);
  vec2 radial = normalize(hit.xy);
  vec3 n = vec3(dot(-dir.xy, radial), dir.z, dot(-dir.xy, vec2(-radial.y, radial.x)));
  vec4 photon = kerrPhoton(r, 0.0, 1.0, uSpin, n);
  float g = shiftFactor(kerrFlowVelocity(r, uSpin, uIscoRg), photon.x, photon.z, r, uSpin);
  float column = uOpticalDepth * pow(r/uInnerRenderRg, -uOpacityExp) * flowPresence(r) * density;
  float alpha = 1.0 - exp(-column/max(abs(dir.z), 0.04));
  return vec4(alpha * flowLight(tEmit, g), alpha);
}
void main() {
  vec3 dir=incidentRay(vNdc);
  // Outside the reach of measurable bending the undisturbed background
  // is already on screen — hand back to it rather than redrawing it,
  // and spend no rays there.
  vec3 cam = uCamRg;
  float ahead = -dot(cam, dir);
  float impact = length(cam + dir * max(ahead, 0.0));
  float coverage = 1.0 - smoothstep(LENSING_SOLID, LENSING_REACH, impact);
  if (ahead <= 0.0 && length(cam) > LENSING_REACH) coverage = 0.0;
  vec4 outer = coverage < 1.0 ? outerDisc(dir) : vec4(0.0);
  if (coverage < 0.004) {
    if (outer.a < 1e-6) discard;
    gl_FragColor = vec4(outer.rgb / outer.a, outer.a * uOpacity);
    return;
  }

  float escapeMask;
  vec3 light=sampleRay(dir,escapeMask);
  // Only pixels straddling capture/escape need extra rays. Everything
  // else receives one native-resolution sample, including the star field.
  if(fwidth(escapeMask)>0.0){
    light=vec3(0.0);
    for(int y=0;y<2;y++)for(int x=0;x<2;x++){
      vec2 offset=(vec2(float(x),float(y))-.5)/uOutputSize;
      float mask;light+=sampleRay(incidentRay(vNdc+offset),mask)*.25;
    }
  }

  float alpha = coverage + (1.0 - coverage) * outer.a;
  vec3 premultiplied = light * coverage + (1.0 - coverage) * outer.rgb;
  gl_FragColor = vec4(premultiplied / max(alpha, 1e-6), alpha * uOpacity);
}
`;

/**
 * Everything the tracer needs to know about a hole. There is only one
 * kind, and only one scale in it: a stellar remnant and a galaxy's
 * nucleus differ by seven orders of magnitude in size and in nothing
 * else, so the same object draws both.
 */
export type BlackHoleSolver = 'regular' | 'fine' | 'reference';

export interface TracedHole {
  /** Dimensionless a★ = Jc/GM². */
  spin: number;
  /** GM/c², metres — the unit every length in the trace is quoted in. */
  gravitationalRadiusM: number;
  /** Unit spin axis; the flow lies square across it. */
  spinAxis: readonly [number, number, number];
  flow: AccretionFlow;
}

/**
 * A black hole drawn by tracing light instead of shading a surface.
 * Every pixel of the screen launches one ray backwards through the
 * Kerr geometry in regular coordinates (see regularKerrGlsl), so the shadow, the photon
 * ring, the lensed galaxy behind, and the accretion flow's wrapped-over
 * image are all consequences of the same integration rather than
 * separate effects layered together. The inner edge, temperature profile,
 * thickness and optical depth come from the flow model. A visible-band
 * Planck integral supplies thin-disk radiance at the shifted temperature.
 * The hot torus uses a separate plasma emission/absorption table. The distant thin disk
 * uses a direct surface intersection beyond the lensing handoff.
 */
export class BlackHoleObject {
  readonly mesh: Mesh;
  private readonly flowNoise: ReturnType<typeof acquireFlowNoise> | undefined;
  private readonly captureTable: ReturnType<typeof createCaptureTable>;
  private readonly spectrum = createFlowSpectrum();
  private readonly hotSpectrum: ReturnType<typeof createHotFlowSpectrum> | null;
  private readonly hotField: HotFlowField | null;
  private readonly outflowSpectrum: ReturnType<typeof createHotOutflowSpectrum> | null;
  private readonly hotAtlas: HotFlowAtlas | null;
  private readonly material: ShaderMaterial;
  private readonly composite: ShaderMaterial;
  private readonly traceScene = new Scene();
  private readonly traceCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly traceQuad: Mesh;
  private readonly target: WebGLRenderTarget;
  private readonly bufferSize = new Vector2();
  private readonly bhFromScene = new Matrix3();
  private readonly cameraRotation = new Matrix3();
  private readonly worldToBh = new Matrix3();
  private readonly savedColor = new Color();
  private readonly tracedState = new Float64Array(18).fill(NaN);
  private readonly nextState = new Float64Array(18);

  /** Kilometres per gravitational radius: the one number that turns
   *  the dimensionless geometry into this hole. */
  readonly kmPerRg: number;
  /** Orbital period at the flow's inner edge, seconds — the clock the
   *  turbulence keeps, since an eddy lasts about one turn of it. */
  private readonly innerPeriodS: number;
  /** Turns of the flow's inner edge drawn so far, and the sim time the
   *  last of them was drawn at. The flow's own clock: it advances with
   *  sim time, but no faster than a frame can show — see
   *  FLOW_TURNS_PER_FRAME. */
  private flowTurns = 0;
  private lastSimS: number | null = null;
  /** Spin axis in scene coordinates — the accretion flow lies square
   *  across it, so this is what a camera frames itself against. */
  readonly spinAxisScene: Vector3;

  constructor(
    hole: TracedHole,
    /** Row-major rotation from the frame the spin axis is quoted in to
     *  the scene's — the sky's galactic→scene matrix for the nucleus,
     *  the identity for a hole already described in scene coordinates. */
    sceneFromFrame: Float32Array,
    /** Alternative solvers are retained for numerical validation. */
    solver: BlackHoleSolver = 'regular',
    /** Direct evaluation is retained to measure material-cache error. */
    plasmaSampling: 'atlas' | 'direct' = 'atlas',
    prepared?: BlackHoleTables,
  ) {
    const reference = solver === 'reference';
    const fine = solver === 'fine';
    this.kmPerRg = hole.gravitationalRadiusM / 1000;
    this.captureTable = createCaptureTable(hole.spin);
    const flow = hole.flow;
    this.hotSpectrum = flow.regime === 'riaf' && flow.eddingtonRatio > FLOW_VISIBILITY_FLOOR
      ? createHotFlowSpectrum(flow, hole.gravitationalRadiusM, prepared?.hot) : null;
    this.outflowSpectrum = this.hotSpectrum && flow.outflows
      ? createHotOutflowSpectrum(flow,hole.gravitationalRadiusM,this.hotSpectrum.data.model.electronTemperatureScale,prepared?.hot?.outflows) : null;
    this.hotField = this.hotSpectrum && flow.eddingtonRatio > FLOW_VISIBILITY_FLOOR
      ? new HotFlowField(flow,hole.gravitationalRadiusM,hole.spin,this.hotSpectrum.data.model,this.hotSpectrum.response) : null;
    this.hotAtlas=this.hotSpectrum&&this.hotField&&plasmaSampling==='atlas'
      ? new HotFlowAtlas(flow.innerRadiusRg,flow.outerRadiusRg,this.hotSpectrum.local,this.hotField.texture):null;
    // No floor: Kerr propagation reaches the flow's own inner edge,
    // which for a starved torus is the horizon itself.
    const innerRender = flow.innerRadiusRg;
    // Retain the existing negligible-flow cutoff. Hot-plasma emission uses
    // a fixed radiance reference and also fades continuously above it.
    const outerDrawn =
      flow.eddingtonRatio > FLOW_VISIBILITY_FLOOR ? drawnFlowRadiusRg(flow) : 0;
    this.flowNoise = outerDrawn > 0 && !reference && flow.regime !== 'riaf' ? acquireFlowNoise(prepared?.noise) : undefined;
    // Thin-disk exposure reference; the plasma branch does not use this.
    const peakRadius = Math.max(discPeakRadiusRg(flow.innerRadiusRg), innerRender);
    const refTempK = Math.max(flowTemperature(flow, peakRadius), 500);
    const refLogVisible = thermalVisibleSample(refTempK)[3];

    // 2π(r^{3/2} + a) in units of r_g/c: the orbital period at the
    // flow's inner edge, which is the only timescale the gas has.
    const inner = Math.max(flow.innerRadiusRg, 1e-3);
    this.innerPeriodS =
      (2 * Math.PI * (inner ** 1.5 + hole.spin) * hole.gravitationalRadiusM) / 2.99792458e8;

    const { sceneFromBh } = spinFrames(hole.spinAxis, sceneFromFrame);
    const isco = iscoRadiusRg(hole.spin);
    const orbit = orbitEnergyAngular(isco, hole.spin);
    this.bhFromScene.copy(sceneFromBh).transpose();
    const e = sceneFromBh.elements;
    // Column-major in three: the third column is the axis image.
    this.spinAxisScene = new Vector3(e[6], e[7], e[8]).normalize();

    this.material = new ShaderMaterial({
      defines: { ...(reference ? { REFERENCE_TRACE: 1 } : fine ? { FINE_TRACE: 1 } : {}),
        ...(plasmaSampling==='direct'?{DIRECT_HOT_PLASMA:1}:{}) },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uCamRg: { value: new Vector3() },
        uViewToBh: { value: new Matrix3() },
        uTanHalfFov: { value: new Vector2(1, 1) },
        uBhToScene: { value: sceneFromBh },
        uSkyCube: { value: null as CubeTexture | null },
        uSkyOpacity: { value: 1 },
        uOpacity: { value: 0 },
        uOutputSize: { value: this.bufferSize },
        uSpin: { value: hole.spin },
        uCaptureTable: { value: this.captureTable.texture },
        uCaptureRange: { value: this.captureTable.range },
        uHorizonRg: { value: horizonRadiusRg(hole.spin) },
        uInnerRg: { value: flow.innerRadiusRg },
        // Where circular orbits stop existing, which is where the flow
        // starts plunging — not where the flow starts.
        uIscoRg: { value: isco },
        uIscoOrbit: { value: new Vector2(orbit.e, orbit.l) },
        uInnerRenderRg: { value: innerRender },
        uOuterRg: { value: outerDrawn },
        uInnerTempK: { value: flow.innerTemperatureK },
        uProfileExp: { value: flow.profileExponent },
        uEdgeTaper: { value: flow.edgeTaper },
        uOpticalDepth: { value: -Math.log(Math.max(1e-3, 1 - flow.opacity)) },
        uOpacityExp: { value: flow.opacityExponent },
        uRefLogVisible: { value: refLogVisible },
        uTurbSigma: { value: flow.turbulenceSigma },
        uAspect: { value: flow.aspectRatio },
        uFlowPhase: { value: 0 },
        uEddyPhase: { value: new Vector4() },
        uEddyNewOffset: { value: new Vector3() },
        uEddyOldOffset: { value: new Vector3() },
        uDiscGain: { value: DISC_EXPOSURE },
        uLut: { value: this.spectrum },
        uHotEmission: { value: this.hotSpectrum?.emission ?? null },
        uHotAbsorption: { value: this.hotSpectrum?.absorption ?? null },
        uHotLocal: { value: this.hotSpectrum?.local ?? null },
        uHotState: { value: this.hotField?.texture ?? null },
        uHotAtlas: { value: this.hotAtlas?.target.texture ?? null },
        uHotPower: { value: this.hotField?.radiationScale ?? 1 },
        uWindSpectrum: { value: this.outflowSpectrum?.wind ?? null },
        uJetSpectrum: { value: this.outflowSpectrum?.jet ?? null },
        uOutflowKinematics: { value: this.outflowSpectrum?.kinematics ?? null },
        uWindLaunch: { value: flow.outflows?.windLaunchRg ?? 8 },
        uJetLaunch: { value: flow.outflows?.jetLaunchRg ?? 3 },
        uWindEnabled: { value: (this.outflowSpectrum?.data.wind.budgetW ?? 0)>0 ? 1 : 0 },
        uJetEnabled: { value: (this.outflowSpectrum?.data.jet.budgetW ?? 0)>0 ? 1 : 0 },
        uHotScatter: { value: (this.hotSpectrum?.data.model.shells[0].plasma.electronDensityCm3 ?? 0)
          * 6.6524587e-25 * hole.gravitationalRadiusM * 100 },
        uFlowNoise: { value: this.flowNoise?.texture ?? null },
      },
      blending: NormalBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    // A hole's geometry and flow profile are immutable. Compile these
    // as constants so the GPU folds powers/branches and removes unused
    // thin-disc or volume code, instead of carrying both through a march.
    if (!reference) {
      for (const name of [
        'uSpin', 'uHorizonRg', 'uInnerRg', 'uIscoRg', 'uInnerRenderRg',
        'uOuterRg', 'uInnerTempK', 'uProfileExp', 'uEdgeTaper', 'uOpticalDepth',
        'uWindLaunch', 'uJetLaunch', 'uWindEnabled', 'uJetEnabled',
        'uOpacityExp', 'uHotScatter', 'uRefLogVisible', 'uTurbSigma', 'uAspect', 'uDiscGain',
      ]) {
        const value = this.material.uniforms[name].value as number;
        this.material.fragmentShader = this.material.fragmentShader.replace(
          `uniform float ${name};`, `const float ${name} = ${value.toExponential(9)};`,
        );
      }
    }
    // The trace draws into a native-resolution target, with
    // blending off so the target holds exactly what it computed.
    this.material.blending = NoBlending;
    this.material.transparent = false;
    this.material.depthTest = false;
    this.traceQuad = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.traceQuad.frustumCulled = false;
    this.traceScene.add(this.traceQuad);
    this.target = new WebGLRenderTarget(2, 2, {
      type: HalfFloatType,
      colorSpace: NoColorSpace,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
    });

    // What the scene draws. It must blend, because the trace covers
    // only the footprint where bending is worth drawing and is
    // transparent everywhere else — opaque, it would paint that
    // emptiness over the sky as a hard-edged disc of nothing.
    this.composite = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      uniforms: { uTrace: { value: this.target.texture } },
      blending: NormalBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.composite);
    this.mesh.frustumCulled = false;
    // Reversed-Z flips three's render lists, so the *lowest* render
    // order draws last: the hole composites over every sky layer, all
    // of which it has already accounted for along its own rays.
    this.mesh.renderOrder = -40;
    this.mesh.visible = false;
  }

  async prepare(prepareObject:(object:Object3D)=>Promise<unknown>):Promise<void> {
    const jobs=[this.traceQuad,this.mesh].map(object=>Promise.resolve().then(()=>prepareObject(object)));
    if(this.hotAtlas)jobs.push(Promise.resolve().then(()=>this.hotAtlas!.prepare(prepareObject)));
    // A failed program must not dispose siblings whose async compile still
    // owns their material properties.
    const results=await Promise.allSettled(jobs);
    const failed=results.find(result=>result.status==='rejected');
    if(failed?.status==='rejected')throw failed.reason;
  }

  /** The sky the bent rays land on, captured from the hole. */
  set sky(target: WebGLCubeRenderTarget) {
    this.material.uniforms.uSkyCube.value = target.texture;
    this.tracedState.fill(NaN);
  }

  /**
   * Per-frame state. The camera's offset from the hole and the world
   * rotation are all the trace needs; the sky opacity matches the
   * galaxy dome's so the lensed background and the unlensed one meet
   * seamlessly at the edge of the footprint.
   */
  update(
    camera: PerspectiveCamera,
    holeWorldKm: Vector3,
    worldToScene: Matrix3,
    opacity: number,
    skyOpacity: number,
    /** Sim time, seconds — the flow turns and re-forms on it. */
    timeS = 0,
  ): void {
    const uniforms = this.material.uniforms;
    this.worldToBh.multiplyMatrices(this.bhFromScene, worldToScene);
    const camRg = (uniforms.uCamRg.value as Vector3)
      .subVectors(camera.position, holeWorldKm)
      .applyMatrix3(this.worldToBh)
      .divideScalar(this.kmPerRg);

    const decades = Math.log10(RENDER_REACH_RG / Math.max(camRg.length(), 1));
    const alpha = opacity * Math.min(1, Math.max(0, decades * 2));
    this.mesh.visible = alpha > 0.002;
    if (!this.mesh.visible) return;
    uniforms.uOpacity.value = alpha;
    uniforms.uSkyOpacity.value = skyOpacity;
    // The flow's clock, advanced by however much of a turn sim time
    // asks for and a frame can show, whichever is less.
    const asked = this.lastSimS === null ? 0 : (timeS - this.lastSimS) / this.innerPeriodS;
    this.lastSimS = timeS;
    const advanced = Math.min(Math.max(asked, 0), FLOW_TURNS_PER_FRAME);
    this.flowTurns += advanced;
    this.hotField?.advance(advanced);
    uniforms.uHotPower.value = this.hotField?.radiationScale ?? 1;
    uniforms.uFlowPhase.value = this.flowTurns;
    if (this.flowNoise) updateFlowEddies(this.flowTurns, uniforms.uEddyPhase.value, uniforms.uEddyNewOffset.value, uniforms.uEddyOldOffset.value);

    // The camera's world matrix is only rebuilt when the scene renders,
    // which happens after this — so read straight off it and the trace
    // is aimed where the camera was pointing last frame while the rest
    // of the frame is drawn from where it points now. Standing still
    // the two agree and nothing shows. Orbiting, they differ by exactly
    // one frame of rotation, and since the traced image is the whole
    // picture at these distances, the hole slides across the screen by
    // that much: fifty pixels at a brisk drag, which is what "dragging
    // sideways drags the black hole sideways" is.
    camera.updateMatrixWorld();
    this.cameraRotation.setFromMatrix4(camera.matrixWorld);
    (uniforms.uViewToBh.value as Matrix3).multiplyMatrices(this.worldToBh, this.cameraRotation);

    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    (uniforms.uTanHalfFov.value as Vector2).set(tanHalf * camera.aspect, tanHalf);
  }

  /**
   * Trace the geodesics into the hole's own target. Called once a frame
   * before the scene is drawn, since the composite quad in the scene
   * does nothing but read the result.
   */
  render(renderer: WebGLRenderer): void {
    if (!this.mesh.visible) return;
    renderer.getDrawingBufferSize(this.bufferSize);
    const width = Math.max(2, this.bufferSize.x);
    const height = Math.max(2, this.bufferSize.y);
    if (this.target.width !== width || this.target.height !== height) {
      this.target.setSize(width, height);
      this.tracedState.fill(NaN);
    }
    const u = this.material.uniforms;
    (u.uCamRg.value as Vector3).toArray(this.nextState, 0);
    this.nextState.set((u.uViewToBh.value as Matrix3).elements, 3);
    (u.uTanHalfFov.value as Vector2).toArray(this.nextState, 12);
    this.nextState[14] = u.uOuterRg.value > 0 ? u.uFlowPhase.value : 0;
    this.nextState[15] = u.uOpacity.value;
    this.nextState[16] = u.uSkyOpacity.value;
    this.nextState[17] = (u.uSkyCube.value as CubeTexture | null)?.userData.lensedSkyVersion ?? 0;
    // Compare what the GPU receives. Camera normalization can move a
    // double by a few ulps while every float uniform stays unchanged.
    for (let i = 0; i < this.nextState.length; i++) this.nextState[i] = Math.fround(this.nextState[i]);
    if (this.nextState.every((value, i) => value === this.tracedState[i])) return;
    if(this.hotField)this.hotAtlas?.render(renderer,this.hotField.dynamics.version);
    const previous = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace();
    const level = renderer.getActiveMipmapLevel();
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.savedColor);
    try {
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.render(this.traceScene, this.traceCamera);
      this.tracedState.set(this.nextState);
    } finally {
      renderer.setRenderTarget(previous, face, level);
      renderer.setClearColor(this.savedColor, alpha);
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.traceQuad.geometry.dispose();
    this.material.dispose();
    this.composite.dispose();
    this.target.dispose();
    this.flowNoise?.release();
    this.captureTable.texture.dispose();
    this.spectrum.dispose();
    this.hotSpectrum?.dispose();
    this.hotField?.dispose();
    this.hotAtlas?.dispose();
    this.outflowSpectrum?.dispose();
  }

  /** Bounded diagnostic data; no renderer state is exposed to the UI. */
  get plasmaStatus() {
    return this.hotField && this.hotSpectrum ? {
      buildMs:this.hotSpectrum.data.buildMs+this.hotSpectrum.response.buildMs+(this.outflowSpectrum?.data.buildMs??0),
      outflows:this.outflowSpectrum?{
        buildMs:this.outflowSpectrum.data.buildMs,
        textureBytes:this.outflowSpectrum.data.wind.pixels.byteLength+this.outflowSpectrum.data.jet.pixels.byteLength+4096,
        wind:{emittedW:this.outflowSpectrum.data.wind.emittedW,budgetW:this.outflowSpectrum.data.wind.budgetW,powerScale:this.outflowSpectrum.data.wind.powerScale},
        jet:{emittedW:this.outflowSpectrum.data.jet.emittedW,budgetW:this.outflowSpectrum.data.jet.budgetW,powerScale:this.outflowSpectrum.data.jet.powerScale},
      }:null,
      fieldUpdateMs:this.hotField.lastUpdateMs,
      ranges:this.hotField.ranges,
      fieldCells:this.hotField.dynamics.state.length/4,
      fieldSubsteps:this.hotField.dynamics.lastSubsteps,
      textureBytes:this.hotSpectrum.response.pixels.byteLength+this.hotField.dynamics.state.byteLength,
      atlasBytes:this.hotAtlas?this.hotAtlas.target.width*this.hotAtlas.target.height*8:0,
      radiationScale:this.hotField.radiationScale,
      saturatedFraction:this.hotField.saturatedFraction,
    } : null;
  }
}

/**
 * The hole's own frame: z along the spin axis, so the accretion flow
 * is the z = 0 plane and the trace never has to carry an orientation.
 */
function spinFrames(
  axis: readonly [number, number, number],
  sceneFromFrame: Float32Array,
): { sceneFromBh: Matrix3 } {
  const n = new Vector3(axis[0], axis[1], axis[2]).normalize();
  const seed = Math.abs(n.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
  const e1 = new Vector3().crossVectors(seed, n).normalize();
  const e2 = new Vector3().crossVectors(n, e1);
  // Columns are the hole's basis expressed in the incoming frame.
  const bhToFrame = new Matrix3().set(
    e1.x, e2.x, n.x,
    e1.y, e2.y, n.y,
    e1.z, e2.z, n.z,
  );
  const m = sceneFromFrame;
  const frameToScene = new Matrix3().set(
    m[0], m[1], m[2],
    m[3], m[4], m[5],
    m[6], m[7], m[8],
  );
  return { sceneFromBh: new Matrix3().multiplyMatrices(frameToScene, bhToFrame) };
}
